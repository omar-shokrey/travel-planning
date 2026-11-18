import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { RoomStatusQueryDto } from './dto/room-status-query.dto';
import type { RoomStatusResponseDto } from './dto/room-status-response.dto';
import { ROOM_QUERY_MAX_NIGHTS } from './hotels.constants';
import { HotelsService } from './hotels.service';
import { toRoomStatusResponse } from './mappers/room-status.mapper';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import { nightCount } from './room-dates';
import { roomStatusSegments, type StoredNight } from './room-status';

/** HTL-08: the moderator's view of the status of every room of the hotel. */
@Injectable()
export class HotelRoomStatusService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
    private readonly hotelsService: HotelsService,
  ) {}

  /**
   * HTL-08: one page of the hotel's rooms, deactivated ones included, each
   * with the status of every night from `from` up to `to` (not included):
   * available, booked (with the reservation), blocked or unavailable.
   */
  async findStatus(
    hotelId: string,
    query: RoomStatusQueryDto,
    userId: string,
  ): Promise<PaginatedResponse<RoomStatusResponseDto>> {
    const range = { from: query.from, to: query.to };
    if (nightCount(range) > ROOM_QUERY_MAX_NIGHTS) {
      throw new BadRequestException(
        `The date range can have at most ${ROOM_QUERY_MAX_NIGHTS} nights`,
      );
    }

    const hotel = await this.hotelsService.findManagedEntityOrThrow(
      hotelId,
      userId,
    );

    const filter = { hotelId: hotel._id };
    const [rooms, total] = await Promise.all([
      this.rooms
        .find(filter)
        .select('number type active availability')
        // A room number is free text: compare its digits as numbers, so
        // room "2" comes before room "10".
        .collation({ locale: 'en', numericOrdering: true })
        .sort({ number: 1, _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.rooms.countDocuments(filter).exec(),
    ]);

    const nights =
      rooms.length === 0
        ? []
        : await this.roomNights
            .find({
              roomId: { $in: rooms.map((room) => room._id) },
              date: { $gte: range.from, $lt: range.to },
            })
            .select('roomId date state bookingId holdExpiresAt')
            .lean()
            .exec();

    const nightsByRoom = new Map<string, StoredNight[]>();
    for (const night of nights) {
      const key = night.roomId.toString();
      const list = nightsByRoom.get(key) ?? [];
      list.push({
        date: night.date,
        state: night.state,
        bookingId: night.bookingId?.toString(),
        holdExpiresAt: night.holdExpiresAt,
      });
      nightsByRoom.set(key, list);
    }

    const now = new Date();
    const items = rooms.map((room) =>
      toRoomStatusResponse(
        room,
        roomStatusSegments(
          range,
          room.availability,
          nightsByRoom.get(room._id.toString()) ?? [],
          now,
        ),
      ),
    );

    return paginate(items, total, query);
  }
}
