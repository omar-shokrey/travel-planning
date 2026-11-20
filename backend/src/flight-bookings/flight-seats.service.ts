import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { CabinClass } from '../flights/models/cabin-class.enum';
import {
  SEAT_CLAIM_ATTEMPTS,
  SEAT_TAKEN_MESSAGE,
} from './flight-bookings.constants';
import { FlightSeatAssignment } from './models/flight-seat-assignment.schema';

/** A seat assignment as stored (FLT-28). */
export type SeatAssignmentSource = FlightSeatAssignment & {
  _id: Types.ObjectId;
};

/** One passenger on one segment of one booking: the key of an assignment. */
export interface SeatKey {
  bookingId: Types.ObjectId;
  segmentIndex: number;
  passengerIndex: number;
}

/** A seat to give one passenger on one segment. */
export interface SeatClaim extends SeatKey {
  flightId: Types.ObjectId;
  cabin: CabinClass;
  userId: Types.ObjectId;
  seatNumber: string;
}

/** A MongoDB duplicate-key error, with the index that refused the write. */
interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
  errmsg?: string;
  message?: string;
}

const isDuplicateKey = (error: unknown): error is DuplicateKeyError =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;

/**
 * Whether the unique (flightId, cabin, seatNumber) index refused the write:
 * from `keyPattern`, or from the message when a server sends no pattern.
 */
const isSeatIndex = (error: DuplicateKeyError): boolean =>
  error.keyPattern !== undefined
    ? 'seatNumber' in error.keyPattern
    : (error.errmsg ?? error.message ?? '').includes('seatNumber');

/**
 * FLT-28: the seat assignments, the only record of chosen seats. Every read
 * and write of the `flight_seat_assignments` collection is here; the rules
 * of selection are in FlightSeatSelectionService.
 */
@Injectable()
export class FlightSeatsService {
  private readonly logger = new Logger(FlightSeatsService.name);

  constructor(
    @InjectModel(FlightSeatAssignment.name)
    private readonly assignments: Model<FlightSeatAssignment>,
  ) {}

  /** The seats of one booking, by segment then passenger. */
  findByBooking(
    bookingId: string | Types.ObjectId,
  ): Promise<SeatAssignmentSource[]> {
    return this.assignments
      .find({ bookingId: new Types.ObjectId(bookingId.toString()) })
      .sort({ segmentIndex: 1, passengerIndex: 1 })
      .lean<SeatAssignmentSource[]>()
      .exec();
  }

  /** The seats of several bookings in one query, by booking id. */
  async findByBookings(
    bookingIds: readonly (string | Types.ObjectId)[],
  ): Promise<Map<string, SeatAssignmentSource[]>> {
    const byBooking = new Map<string, SeatAssignmentSource[]>();
    if (bookingIds.length === 0) return byBooking;
    const found = await this.assignments
      .find({
        bookingId: {
          $in: bookingIds.map((id) => new Types.ObjectId(id.toString())),
        },
      })
      .sort({ segmentIndex: 1, passengerIndex: 1 })
      .lean<SeatAssignmentSource[]>()
      .exec();
    for (const seat of found) {
      const key = seat.bookingId.toString();
      byBooking.set(key, [...(byBooking.get(key) ?? []), seat]);
    }
    return byBooking;
  }

  /** Every taken seat of one cabin of one flight. */
  takenOn(
    flightId: Types.ObjectId,
    cabin: CabinClass,
  ): Promise<SeatAssignmentSource[]> {
    return this.assignments
      .find({ flightId, cabin })
      .lean<SeatAssignmentSource[]>()
      .exec();
  }

  /**
   * Gives one passenger a seat with one upsert keyed by the passenger: a
   * change frees the old seat and takes the new one in the same write. The
   * unique seat index decides a race for the seat (409 "Seat already
   * taken"); a race on the same passenger (two first choices at once) is
   * tried once more and then updates the document the other request made.
   * Returns the seat the passenger had before, or null.
   */
  async claim(claim: SeatClaim): Promise<string | null> {
    const { bookingId, segmentIndex, passengerIndex, ...seat } = claim;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const before = await this.assignments
          .findOneAndUpdate(
            { bookingId, segmentIndex, passengerIndex },
            { $set: seat },
            { upsert: true, returnDocument: 'before', runValidators: true },
          )
          .lean<SeatAssignmentSource>()
          .exec();
        return before?.seatNumber ?? null;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (isSeatIndex(error)) {
          throw new ConflictException(SEAT_TAKEN_MESSAGE);
        }
        if (attempt >= SEAT_CLAIM_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * Undoes one claim of a request that failed later (all or nothing): the
   * passenger goes back to `previous`, or loses the seat if they had none.
   * Conditional on the passenger still holding `taken`, so a newer change is
   * never undone. If someone took `previous` in between, the passenger keeps
   * `taken` and the failure is logged. Never throws.
   */
  async restore(
    key: SeatKey,
    taken: string,
    previous: string | null,
  ): Promise<void> {
    const filter = { ...key, seatNumber: taken };
    try {
      if (previous === null) {
        await this.assignments.deleteOne(filter).exec();
      } else {
        await this.assignments
          .updateOne(filter, { $set: { seatNumber: previous } })
          .exec();
      }
    } catch (error) {
      this.logger.error(
        `Could not give passenger ${key.passengerIndex} of booking ${key.bookingId.toString()} back seat ${previous ?? '(none)'} on segment ${key.segmentIndex}; they keep ${taken}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Frees every seat of one booking when it no longer needs them (FLT-26
   * cancellation, hold expiry, FLT-06 airline cancellation). The filter is
   * the booking's id only. Returns how many seats were freed.
   */
  async releaseBooking(bookingId: string | Types.ObjectId): Promise<number> {
    const { deletedCount } = await this.assignments
      .deleteMany({ bookingId: new Types.ObjectId(bookingId.toString()) })
      .exec();
    return deletedCount;
  }

  /**
   * FLT-27: frees the seats of one segment of a booking, when that flight is
   * changed to another one (the seat numbers of the old flight mean nothing
   * on the new one). The filter is the booking's id and the segment only.
   * Returns how many seats were freed.
   */
  async releaseSegment(
    bookingId: string | Types.ObjectId,
    segmentIndex: number,
  ): Promise<number> {
    const { deletedCount } = await this.assignments
      .deleteMany({
        bookingId: new Types.ObjectId(bookingId.toString()),
        segmentIndex,
      })
      .exec();
    return deletedCount;
  }
}
