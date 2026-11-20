import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, Types } from 'mongoose';
import { HOTEL_BOOKINGS_COLLECTION } from './hotels.constants';

/**
 * The fields of a reservation this class reads, as the data model in
 * specs/travel-platform.md ("Hotel bookings") defines them.
 */
interface HotelBookingRecord {
  hotelId: Types.ObjectId;
  rooms: { roomId: Types.ObjectId }[];
}

/**
 * HTL-22: the reservation statuses a hotel moderator sees. They are the
 * values of `status` in `hotel_bookings` (GEN-11); a reservation waiting for
 * payment or whose hold ran out was never a stay of the hotel, so it is not
 * shown. The spec checks the values against the hotel-bookings module.
 */
export enum ModeratorReservationStatus {
  Confirmed = 'confirmed',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

/** HTL-22: one reservation of a hotel as the moderator's list reads it. */
export interface HotelReservationRecord {
  _id: Types.ObjectId;
  reference?: string;
  userId: Types.ObjectId;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: ModeratorReservationStatus;
  rooms: { roomLabel: string; adults: number; childAges: number[] }[];
  createdAt: Date;
}

/** The fields the moderator's list reads: no price, payment or policy field. */
const RESERVATION_PROJECTION = {
  reference: 1,
  userId: 1,
  checkIn: 1,
  checkOut: 1,
  nights: 1,
  status: 1,
  'rooms.roomLabel': 1,
  'rooms.adults': 1,
  'rooms.childAges': 1,
  createdAt: 1,
} as const;

/**
 * What the hotels module needs to know about reservations. The hotel-bookings
 * module owns them and imports this module, so this one cannot import it back:
 * it reads the `hotel_bookings` collection with the native driver and never
 * writes. It is the only place in the hotels module that knows how
 * reservations are stored.
 */
@Injectable()
export class HotelBookingLookup {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * HTL-06: whether any reservation, in any status, ever included this room.
   * The nights of an expired reservation are released (HTL-18), so its
   * `room_nights` are gone, but the room was still reserved.
   */
  async wasEverReserved(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
  ): Promise<boolean> {
    const reservation = await this.connection
      .collection<HotelBookingRecord>(HOTEL_BOOKINGS_COLLECTION)
      .findOne({ hotelId, 'rooms.roomId': roomId }, { projection: { _id: 1 } });
    return reservation !== null;
  }

  /**
   * HTL-22: one page of the reservations of a hotel, most recent check-in
   * first (`_id` breaks ties), with the total count. Only the statuses a
   * moderator sees, or one of them. Only the fields of the list are read.
   */
  async listForHotel(
    hotelId: Types.ObjectId,
    status: ModeratorReservationStatus | undefined,
    page: { skip: number; limit: number },
  ): Promise<{ items: HotelReservationRecord[]; total: number }> {
    const filter = {
      hotelId,
      status: status ?? { $in: Object.values(ModeratorReservationStatus) },
    };
    const collection = this.connection.collection<HotelReservationRecord>(
      HOTEL_BOOKINGS_COLLECTION,
    );
    const [items, total] = await Promise.all([
      collection
        .find(filter, { projection: RESERVATION_PROJECTION })
        .sort({ checkIn: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
