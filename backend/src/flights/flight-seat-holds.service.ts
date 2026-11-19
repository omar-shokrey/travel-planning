import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { effectiveStatus, scheduledFlightFilter } from './flight-status';
import { FLIGHT_NOT_FOUND_MESSAGE } from './flights.constants';
import { Airline } from './models/airline.schema';
import type { CabinClass } from './models/cabin-class.enum';
import { FlightStatus } from './models/flight-status.enum';
import { Flight, type FlightCabin } from './models/flight.schema';

/** The answers of a seat hold (FLT-22). A missing flight is FLIGHT_NOT_FOUND_MESSAGE. */
export const FLIGHT_NOT_BOOKABLE_MESSAGE =
  'This flight can no longer be booked';
export const NOT_ENOUGH_SEATS_MESSAGE = 'Not enough seats left in this cabin';
export const cabinNotOnFlightMessage = (cabin: CabinClass): string =>
  `This flight has no ${cabin} cabin`;

/** The flight as the seat update left it: the booking copies the fare and the airline from it. */
export interface HeldFlight {
  _id: Types.ObjectId;
  airlineId: Types.ObjectId;
  cabins: FlightCabin[];
}

type FlightId = Types.ObjectId | string;

/**
 * The aggregation condition "the cabin `cabin` has at least `seats` seats
 * left", that is `totalSeats - bookedSeats - heldSeats >= seats` for the one
 * cabin of that class. `$filter` finds the cabin, `$arrayElemAt` takes it
 * (a flight has each class at most once, FLT-04).
 */
export function cabinHasSeatsLeft(
  cabin: CabinClass,
  seats: number,
): Record<string, unknown> {
  return {
    $gte: [
      {
        $let: {
          vars: {
            c: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: '$cabins',
                    cond: { $eq: ['$$this.cabin', cabin] },
                  },
                },
                0,
              ],
            },
          },
          in: {
            $subtract: [
              '$$c.totalSeats',
              { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
            ],
          },
        },
      },
      seats,
    ],
  };
}

/**
 * FLT-22: the flight side of a booking. The flight-bookings module owns the
 * booking; this module owns the flight document and its seat counters, so a
 * booking holds and releases seats only through this service. Only the
 * booking modules may change `heldSeats` and `bookedSeats`.
 */
@Injectable()
export class FlightSeatHoldsService {
  private readonly logger = new Logger(FlightSeatHoldsService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
  ) {}

  /**
   * Holds `seats` seats of the `cabin` cabin with one conditional update on
   * the flight: it matches only a scheduled flight that departs after `now`
   * (FLT-30) whose cabin has at least `seats` seats left, and then adds them
   * to that cabin's `heldSeats`. MongoDB applies the condition and the change
   * to the one document atomically, so requests at the same moment can never
   * hold more seats than exist. No transaction is needed.
   *
   * A read before the update only chooses the right answer: 404 for a
   * missing flight or one of a deactivated airline (ACC-15), 409 for a
   * flight that is no longer scheduled, 404 for a cabin the flight does not
   * have. If the update then matches nothing, a second read tells a flight
   * that stopped being bookable (409) from a full cabin (409). Nothing is
   * held in any error case.
   *
   * Returns the flight as the update left it, so the caller reads the price
   * of the same moment the seats were taken.
   */
  async hold(
    flightId: FlightId,
    cabin: CabinClass,
    seats: number,
    now: Date,
  ): Promise<HeldFlight> {
    assertSeatCount(seats);

    const flight = await this.flights
      .findById(flightId)
      .select('airlineId status departureAt cabins.cabin')
      .lean()
      .exec();
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    // An airline stored before ACC-15 has no `active` field and counts as active.
    const airlineActive = await this.airlines
      .exists({ _id: flight.airlineId, active: { $ne: false } })
      .exec();
    if (!airlineActive) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    if (effectiveStatus(flight, now) !== FlightStatus.Scheduled) {
      throw new ConflictException(FLIGHT_NOT_BOOKABLE_MESSAGE);
    }
    if (!(flight.cabins ?? []).some((stored) => stored.cabin === cabin)) {
      throw new NotFoundException(cabinNotOnFlightMessage(cabin));
    }

    const held = await this.flights
      .findOneAndUpdate(
        {
          _id: flightId,
          ...scheduledFlightFilter(now),
          cabins: { $elemMatch: { cabin } },
          $expr: cabinHasSeatsLeft(cabin, seats),
        },
        { $inc: { 'cabins.$[c].heldSeats': seats } },
        { arrayFilters: [{ 'c.cabin': cabin }], returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (held) {
      return held;
    }

    // Nothing matched: either the flight stopped being bookable since the
    // read (cancelled, deleted), or the cabin has too few seats left.
    const latest = await this.flights
      .findById(flightId)
      .select('status departureAt')
      .lean()
      .exec();
    if (!latest) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    if (effectiveStatus(latest, now) !== FlightStatus.Scheduled) {
      throw new ConflictException(FLIGHT_NOT_BOOKABLE_MESSAGE);
    }
    throw new ConflictException(NOT_ENOUGH_SEATS_MESSAGE);
  }

  /**
   * Gives back `seats` held seats of the `cabin` cabin: when a hold expires,
   * or when the booking could not be saved after the hold. One update that
   * matches only if the cabin holds at least that many seats, so a counter
   * never goes below 0. Returns whether it matched. A mismatch means the
   * counter disagrees with the bookings: it is logged so the counter can be
   * recomputed from them (the counters are caches, see the spec), and never
   * thrown at the user.
   */
  async release(
    flightId: FlightId,
    cabin: CabinClass,
    seats: number,
  ): Promise<boolean> {
    assertSeatCount(seats);

    const { matchedCount } = await this.flights
      .updateOne(
        {
          _id: flightId,
          cabins: { $elemMatch: { cabin, heldSeats: { $gte: seats } } },
        },
        { $inc: { 'cabins.$[c].heldSeats': -seats } },
        { arrayFilters: [{ 'c.cabin': cabin }] },
      )
      .exec();
    if (matchedCount === 0) {
      this.logger.warn(
        `Could not release ${seats} held ${cabin} seat(s) of flight ${String(flightId)}: the flight is gone or holds fewer seats. Recompute heldSeats from the bookings.`,
      );
      return false;
    }
    return true;
  }
}

/** A programming error, never user input: the DTO limits the seats. */
function assertSeatCount(seats: number): void {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new RangeError(`seats must be a whole number of 1 or more: ${seats}`);
  }
}
