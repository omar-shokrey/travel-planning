import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { type Connection, Types } from 'mongoose';
import {
  FLIGHT_BOOKING_CONFIRMED,
  FLIGHT_BOOKING_PENDING_PAYMENT,
  FLIGHT_BOOKINGS_COLLECTION,
} from './flights.constants';

/**
 * The fields of a flight booking this class reads, as the data model in
 * specs/travel-platform.md ("Flight bookings") defines them.
 */
interface FlightBookingRecord {
  userId: Types.ObjectId;
  status: string;
  segments: { flightId: Types.ObjectId }[];
}

/** The statuses that hold a flight: a pending payment and a confirmed booking. */
const ACTIVE_STATUSES = [
  FLIGHT_BOOKING_PENDING_PAYMENT,
  FLIGHT_BOOKING_CONFIRMED,
];

/**
 * What the flight edit (FLT-05) needs to know about the bookings of a flight,
 * before the booking module exists (FLT-19, FLT-21). It reads the
 * `flight_bookings` collection with the native driver and never writes. It is
 * the only place in the flights module that knows how bookings are stored:
 * FLT-21 replaces it with the booking module's service.
 */
@Injectable()
export class FlightBookingLookup {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * The users with a confirmed booking of this flight, each once: a user with
   * two confirmed bookings is one passenger to notify.
   */
  async confirmedUserIds(flightId: string): Promise<Types.ObjectId[]> {
    return this.bookings().distinct('userId', {
      'segments.flightId': new Types.ObjectId(flightId),
      status: FLIGHT_BOOKING_CONFIRMED,
    });
  }

  /**
   * Whether a booking still holds this flight: one waiting for its payment or
   * a confirmed one. An expired or cancelled booking holds nothing, and a
   * completed one is for a flight that has already flown.
   */
  async hasActiveBooking(flightId: string): Promise<boolean> {
    const booking = await this.bookings().findOne(
      {
        'segments.flightId': new Types.ObjectId(flightId),
        status: { $in: ACTIVE_STATUSES },
      },
      { projection: { _id: 1 } },
    );
    return booking !== null;
  }

  private bookings() {
    return this.connection.collection<FlightBookingRecord>(
      FLIGHT_BOOKINGS_COLLECTION,
    );
  }
}
