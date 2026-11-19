import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { AvailableRoomResponseDto } from './dto/available-room-response.dto';
import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { isFreeForStay, type SearchNight } from './hotel-search';
import { toAvailableRoomResponse } from './mappers/available-room.mapper';
import { Hotel } from './models/hotel.schema';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import { nightCount, type DateRange } from './room-dates';
import { assertStay } from './stay-rules';

/** The room fields the free-room rule and the response need. */
const ROOM_FIELDS = 'number type beds maxOccupancy pricePerNight availability';

/**
 * HTL-15: the rooms of one hotel that are free for a stay. Whether a room is
 * free is decided by `isFreeForStay` in `hotel-search.ts`, the rule hotel
 * search (HTL-11) uses, so the two routes always agree. It only reads: a room
 * listed here can be taken before the user books it, and the hold of HTL-18
 * relies on the unique (`roomId`, `date`) index of `room_nights`, not on this
 * list.
 */
@Injectable()
export class HotelAvailableRoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
  ) {}

  /**
   * HTL-15: one page of the free rooms of an active hotel, by room number. A
   * missing or deactivated hotel (ACC-15) answers 404.
   */
  async findAvailable(
    hotelId: string,
    query: AvailableRoomsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<AvailableRoomResponseDto>> {
    const stay = { from: query.checkIn, to: query.checkOut };
    assertStay(stay);

    const hotel = await this.hotels
      .exists({ _id: hotelId, active: true })
      .exec();
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    const free = await this.listAvailable(hotel._id, stay, now);
    return paginate(
      free.slice(query.skip, query.skip + query.limit),
      free.length,
      query,
    );
  }

  /**
   * Every free room of a hotel for the stay, by room number, without pages.
   * The hotel page (HTL-02) calls it after it has found the active hotel and
   * checked the stay with `assertStay`.
   */
  async listAvailable(
    hotelId: Types.ObjectId,
    stay: DateRange,
    now: Date = new Date(),
  ): Promise<AvailableRoomResponseDto[]> {
    // Only rooms bookable on the first night can be free for the stay, as in
    // hotel search; `isFreeForStay` checks every night below. Room numbers are
    // free text, so they are compared with their digits as numbers (2 before
    // 10), as in HTL-08.
    const rooms = await this.rooms
      .find({
        hotelId,
        active: true,
        availability: {
          $elemMatch: { from: { $lte: stay.from }, to: { $gt: stay.from } },
        },
      })
      .select(ROOM_FIELDS)
      .collation({ locale: 'en', numericOrdering: true })
      .sort({ number: 1, _id: 1 })
      .lean()
      .exec();
    if (rooms.length === 0) return [];

    const nights = await this.roomNights
      .find({
        roomId: { $in: rooms.map((room) => room._id) },
        date: { $gte: stay.from, $lt: stay.to },
      })
      .select('roomId date state holdExpiresAt')
      .lean()
      .exec();
    const nightsByRoom = new Map<string, SearchNight[]>();
    for (const night of nights) {
      const key = night.roomId.toString();
      nightsByRoom.set(key, [...(nightsByRoom.get(key) ?? []), night]);
    }

    const count = nightCount(stay);
    return rooms
      .filter((room) =>
        isFreeForStay(
          room,
          stay,
          nightsByRoom.get(room._id.toString()) ?? [],
          now,
        ),
      )
      .map((room) => toAvailableRoomResponse(room, count));
  }
}
