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
}
