import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { RoomResponseDto } from './dto/room-response.dto';
import type { SetRoomAvailabilityDto } from './dto/set-room-availability.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';
import { HotelsService } from './hotels.service';
import { toRoomResponse } from './mappers/room.mapper';
import { RoomNightState } from './models/room-night-state.enum';
import { RoomNight } from './models/room-night.schema';
import { Room, type RoomDocument } from './models/room.schema';
import { coversNight, findOverlap, sortRanges } from './room-dates';

/** How many nights an error message names before it says "and N more". */
const NIGHTS_IN_MESSAGE = 5;

/** The fields of a room that HTL-05 lets a moderator change. */
const EDITABLE_FIELDS = ['beds', 'maxOccupancy', 'pricePerNight'] as const;

/** Editing the rooms of a hotel by its moderator (HTL-05). */
@Injectable()
export class HotelRoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
    private readonly hotelsService: HotelsService,
  ) {}

  /**
   * HTL-05: changes the beds, occupancy or price of a room. A reservation
   * stores the price it was made at, so a new price applies to new
   * reservations only.
   */
  async update(
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
    userId: string,
  ): Promise<RoomResponseDto> {
    const changes: Partial<Pick<Room, (typeof EDITABLE_FIELDS)[number]>> = {};
    for (const field of EDITABLE_FIELDS) {
      const value = dto[field];
      if (value !== undefined) {
        changes[field] = value;
      }
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(
        'Send at least one of beds, maxOccupancy or pricePerNight',
      );
    }

    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);

    room.set(changes);
    await room.save();

    return toRoomResponse(room);
  }

  /**
   * HTL-05: replaces the date ranges in which a room is bookable. A night
   * that a reservation holds or has booked must stay inside the new ranges.
   */
  async setAvailability(
    hotelId: string,
    roomId: string,
    dto: SetRoomAvailabilityDto,
    userId: string,
  ): Promise<RoomResponseDto> {
    const overlap = findOverlap(dto.availability);
    if (overlap) {
      const [first, second] = overlap;
      throw new BadRequestException(
        `Availability ranges must not overlap: ${first.from} to ${first.to} and ${second.from} to ${second.to}`,
      );
    }

    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);
    const ranges = sortRanges(dto.availability).map(({ from, to }) => ({
      from,
      to,
    }));

    const stranded = (await this.reservedNightsOf(room)).filter(
      (date) => !coversNight(ranges, date),
    );
    if (stranded.length > 0) {
      const named = stranded.slice(0, NIGHTS_IN_MESSAGE).join(', ');
      const rest = stranded.length - NIGHTS_IN_MESSAGE;
      throw new ConflictException(
        `Availability cannot be removed for nights with a reservation: ${named}${
          rest > 0 ? ` and ${rest} more` : ''
        }`,
      );
    }

    room.availability = ranges;
    await room.save();

    return toRoomResponse(room);
  }

  /**
   * The nights of a room that a reservation has: booked by a Confirmed one,
   * or held by one in Pending Payment whose hold has not expired. Blocked
   * nights are the moderator's own and do not count.
   */
  private async reservedNightsOf(room: RoomDocument): Promise<string[]> {
    const nights = await this.roomNights
      .find({
        roomId: room._id,
        $or: [
          { state: RoomNightState.Booked },
          { state: RoomNightState.Held, holdExpiresAt: { $gt: new Date() } },
        ],
      })
      .select('date')
      .sort({ date: 1 })
      .lean()
      .exec();

    return nights.map((night) => night.date);
  }

  /**
   * 404 when the hotel or the room does not exist, 403 when the hotel is not
   * the moderator's. A room of another hotel answers 404: the room is looked
   * up inside the hotel of the route.
   */
  private async findManagedRoomOrThrow(
    hotelId: string,
    roomId: string,
    userId: string,
  ): Promise<RoomDocument> {
    const hotel = await this.hotelsService.findManagedEntityOrThrow(
      hotelId,
      userId,
    );

    const room = await this.rooms
      .findOne({ _id: roomId, hotelId: hotel._id })
      .exec();
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return room;
  }
}
