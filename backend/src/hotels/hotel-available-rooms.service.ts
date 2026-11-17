import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { AvailableRoomResponseDto } from './dto/available-room-response.dto';
import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { ROOM_QUERY_MAX_NIGHTS } from './hotels.constants';
import { toAvailableRoomResponse } from './mappers/available-room.mapper';
import { Hotel } from './models/hotel.schema';
import { RoomNightState } from './models/room-night-state.enum';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import {
  coversNight,
  nightCount,
  nightsOf,
  todayUtc,
  type DateRange,
} from './room-dates';

/** A stay: `from` is the check-in date, `to` the check-out date. */
export type Stay = DateRange;

/** A room of the hotel that is free for a whole stay. */
export type FreeRoom = Pick<
  Room,
  'number' | 'type' | 'beds' | 'maxOccupancy' | 'pricePerNight'
> & { _id: Types.ObjectId };

/**
 * HTL-15: the rooms of a hotel that are free for a stay. A room is free when
 * it is active, its availability (HTL-04) covers every night of the stay, and
 * no night of the stay is booked, blocked (HTL-06) or held by a hold that has
 * not expired.
 */
@Injectable()
export class HotelAvailableRoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
  ) {}

  /** HTL-15: one page of the free rooms of an active hotel, by room number. */
  async findAvailable(
    hotelId: string,
    query: AvailableRoomsQueryDto,
  ): Promise<PaginatedResponse<AvailableRoomResponseDto>> {
    const stay = { from: query.checkIn, to: query.checkOut };
    this.assertStay(stay);

    const hotel = await this.hotels
      .exists({ _id: hotelId, active: true })
      .exec();
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    const free = await this.findFreeRoomEntities(hotel._id, stay);
    const nights = nightCount(stay);
    const page = free
      .slice(query.skip, query.skip + query.limit)
      .map((room) => toAvailableRoomResponse(room, nights));

    return paginate(page, free.length, query);
  }

  /**
   * HTL-02: every free room of a hotel the caller has already found, for the
   * hotel page. The stay must have passed `assertStay`.
   */
  async listAvailable(
    hotelId: Types.ObjectId,
    stay: Stay,
  ): Promise<AvailableRoomResponseDto[]> {
    const nights = nightCount(stay);
    return (await this.findFreeRoomEntities(hotelId, stay)).map((room) =>
      toAvailableRoomResponse(room, nights),
    );
  }

  /**
   * 400 for a stay that starts in the past (UTC) or is longer than 366 nights.
   * The order of the dates is checked by the query DTO.
   */
  assertStay(stay: Stay): void {
    if (stay.from < todayUtc()) {
      throw new BadRequestException('The check-in date cannot be in the past');
    }
    if (nightCount(stay) > ROOM_QUERY_MAX_NIGHTS) {
      throw new BadRequestException(
        `A stay can have at most ${ROOM_QUERY_MAX_NIGHTS} nights`,
      );
    }
  }

  /**
   * The rooms of the hotel that are free for the whole stay, by room number.
   * Hotel search (HTL-11) and booking (HTL-16) need the same rule; the hold
   * of HTL-18 must still rely on the unique (`roomId`, `date`) index, because
   * a room can be taken between this read and the hold.
   */
  async findFreeRoomEntities(
    hotelId: Types.ObjectId,
    stay: Stay,
  ): Promise<FreeRoom[]> {
    const byHotel = await this.findFreeRoomsOfHotels([hotelId], stay);
    return byHotel.get(hotelId.toString()) ?? [];
  }

  /**
   * HTL-11: the free rooms of several hotels at once, by hotel id (as a
   * string), each list by room number. A hotel with no free room has no
   * entry. Two queries in all, whatever the number of hotels.
   */
  async findFreeRoomsOfHotels(
    hotelIds: readonly Types.ObjectId[],
    stay: Stay,
  ): Promise<Map<string, FreeRoom[]>> {
    const byHotel = new Map<string, FreeRoom[]>();
    if (hotelIds.length === 0) {
      return byHotel;
    }

    const rooms = await this.rooms
      .find({ hotelId: { $in: hotelIds }, active: true })
      .select(
        'hotelId number type beds maxOccupancy pricePerNight availability',
      )
      .sort({ number: 1, _id: 1 })
      .lean()
      .exec();

    const nights = nightsOf(stay);
    const bookable = rooms.filter((room) =>
      nights.every((date) => coversNight(room.availability, date)),
    );
    if (bookable.length === 0) {
      return byHotel;
    }

    const taken = await this.roomNights
      .distinct('roomId', {
        roomId: { $in: bookable.map((room) => room._id) },
        date: { $gte: stay.from, $lt: stay.to },
        $or: [
          { state: { $in: [RoomNightState.Booked, RoomNightState.Blocked] } },
          { state: RoomNightState.Held, holdExpiresAt: { $gt: new Date() } },
        ],
      })
      .exec();
    const takenIds = new Set(taken.map((id) => id.toString()));

    for (const room of bookable) {
      if (takenIds.has(room._id.toString())) {
        continue;
      }
      const { _id, number, type, beds, maxOccupancy, pricePerNight } = room;
      const key = room.hotelId.toString();
      const list = byHotel.get(key) ?? [];
      list.push({ _id, number, type, beds, maxOccupancy, pricePerNight });
      byHotel.set(key, list);
    }
    return byHotel;
  }
}
