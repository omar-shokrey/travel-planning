import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Flight } from '../flights/models/flight.schema';
import type { SeatMapResponseDto } from './dto/booking-seats-response.dto';
import type { FlightBookingDetailsResponseDto } from './dto/flight-booking-details-response.dto';
import type { SelectSeatsDto } from './dto/select-seats.dto';
import {
  SEATS_DEPARTED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEAT_TAKEN_MESSAGE,
} from './flight-bookings.constants';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightBookingListService } from './flight-booking-list.service';
import { FlightSeatsService, type SeatKey } from './flight-seats.service';
import { type SegmentSeatMap, toSeatMap } from './mappers/booking-seats.mapper';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import { FlightBooking } from './models/flight-booking.schema';
import { buildSeatMap } from './seat-map';
import {
  bookingStateError,
  flightStateError,
  holdsSeat,
  isTakenByAnother,
  passengerErrors,
  resolveSegmentIndex,
  seatMapErrors,
} from './seat-selection-rules';

/** What the selection reads of a segment's flight. */
type SeatFlight = Pick<Flight, 'status' | 'departureAt' | 'cabins'> & {
  _id: Types.ObjectId;
};

const validationFailed = (
  errors: { field: string; messages: string[] }[],
): BadRequestException =>
  new BadRequestException({ message: 'Validation failed', errors });

/**
 * FLT-28: seat selection for the owner of a booking. The seats live in
 * `flight_seat_assignments` (FlightSeatsService); choosing one never changes
 * the flight's seat counters. Only the owner's booking is read: another
 * user's is 404, like a missing one (ACC-11).
 */
@Injectable()
export class FlightSeatSelectionService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly seats: FlightSeatsService,
    private readonly lists: FlightBookingListService,
  ) {}

  /**
   * PATCH /api/flight-bookings/:id/seat. In this order: the booking is the
   * user's (404); the segment (400); the booking is confirmed (409); the
   * flight exists, is scheduled and has not departed (409); each passenger
   * exists and takes a seat (400); each seat is on the cabin's seat map
   * (400); each seat is free, or already this passenger's (409). Then one
   * claim per passenger whose seat changes (the same seat again writes
   * nothing). All or nothing: when a claim loses a race, the passengers
   * this request already moved get their previous seats back and the
   * answer is 409. If the booking was cancelled during the claims, its
   * seats are freed again and the answer is 409. Returns the booking's
   * details, as GET :id does.
   */
  async select(
    id: string,
    userId: string,
    dto: SelectSeatsDto,
    now: Date = new Date(),
  ): Promise<FlightBookingDetailsResponseDto> {
    const booking = await this.findOwnedOrThrow(id, userId);
    const choice = resolveSegmentIndex(
      booking.segments.length,
      dto.segmentIndex,
    );
    if (choice.error) throw validationFailed([choice.error]);
    const { segmentIndex } = choice;
    const segment = booking.segments[segmentIndex];

    const stateError = bookingStateError(booking.status);
    if (stateError) throw new ConflictException(stateError);
    const flight = await this.flights
      .findById(segment.flightId)
      .select('status departureAt cabins')
      .lean<SeatFlight>()
      .exec();
    // A flight that no longer exists cannot be checked: as FLT-26 does, it
    // counts as departed.
    if (!flight) throw new ConflictException(SEATS_DEPARTED_MESSAGE);
    const flightError = flightStateError(flight, now);
    if (flightError) throw new ConflictException(flightError);

    const people = passengerErrors(booking.passengers ?? [], dto.seats);
    if (people.length > 0) throw validationFailed(people);
    const cabin = flight.cabins.find((one) => one.cabin === segment.cabin);
    const seatMap = new Set(
      buildSeatMap(segment.cabin, cabin?.totalSeats ?? 0),
    );
    const offMap = seatMapErrors(seatMap, segment.cabin, dto.seats);
    if (offMap.length > 0) throw validationFailed(offMap);

    const taken = await this.seats.takenOn(segment.flightId, segment.cabin);
    const bookingId = booking._id.toString();
    if (
      dto.seats.some((seat) =>
        isTakenByAnother(taken, bookingId, segmentIndex, seat),
      )
    ) {
      throw new ConflictException(SEAT_TAKEN_MESSAGE);
    }

    const moved: { key: SeatKey; taken: string; previous: string | null }[] =
      [];
    try {
      for (const seat of dto.seats) {
        // The same seat again changes nothing, not even the document.
        if (holdsSeat(taken, bookingId, segmentIndex, seat)) continue;
        const key: SeatKey = {
          bookingId: booking._id,
          segmentIndex,
          passengerIndex: seat.passengerIndex,
        };
        const previous = await this.seats.claim({
          ...key,
          flightId: segment.flightId,
          cabin: segment.cabin,
          userId: booking.userId,
          seatNumber: seat.seatNumber,
        });
        if (previous !== seat.seatNumber) {
          moved.push({ key, taken: seat.seatNumber, previous });
        }
      }
    } catch (error) {
      for (const step of moved.reverse()) {
        await this.seats.restore(step.key, step.taken, step.previous);
      }
      throw error;
    }

    // A cancellation (FLT-26, FLT-06) may have set the status and freed the
    // seats between the check above and the claims. Every such path writes
    // the status before it frees the seats, so reading it again here is
    // enough: if it is no longer confirmed, this request frees what it gave.
    const stillConfirmed = await this.bookings
      .countDocuments(
        { _id: booking._id, status: FlightBookingStatus.Confirmed },
        { limit: 1 },
      )
      .exec();
    if (stillConfirmed === 0) {
      await this.seats.releaseBooking(booking._id);
      throw new ConflictException(SEATS_NOT_CONFIRMED_MESSAGE);
    }
    return this.lists.details(id, userId, now);
  }

  /**
   * GET /api/flight-bookings/:id/seat-map: the seat map of each segment's
   * booked cabin, with the seats this booking holds and the ones others
   * hold, and each passenger's seats. Any status: it only reads.
   */
  async seatMap(id: string, userId: string): Promise<SeatMapResponseDto> {
    const booking = await this.findOwnedOrThrow(id, userId);
    const flights = await this.flights
      .find({ _id: { $in: booking.segments.map((one) => one.flightId) } })
      .select('cabins')
      .lean<Pick<SeatFlight, '_id' | 'cabins'>[]>()
      .exec();
    const segmentMaps: SegmentSeatMap[] = await Promise.all(
      booking.segments.map(async (segment) => {
        const flight = flights.find((one) => one._id.equals(segment.flightId));
        const cabin = flight?.cabins.find((one) => one.cabin === segment.cabin);
        return {
          seatNumbers: buildSeatMap(segment.cabin, cabin?.totalSeats ?? 0),
          taken: await this.seats.takenOn(segment.flightId, segment.cabin),
        };
      }),
    );
    const own = await this.seats.findByBooking(booking._id);
    return toSeatMap(booking, segmentMaps, own);
  }

  /** The owner's booking as stored; 404 for a missing one or another user's. */
  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<FlightBookingSource> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean<FlightBookingSource>()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    return booking;
  }
}
