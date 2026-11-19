import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { ManagedRoomResponseDto } from './dto/managed-room-response.dto';
import type { SetRoomAvailabilityDto } from './dto/set-room-availability.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';
import { HotelBookingLookup } from './hotel-booking-lookup.service';
import { ROOM_BLOCK_MAX_NIGHTS } from './hotels.constants';
import { HotelsService } from './hotels.service';
import { toManagedRoomResponse } from './mappers/managed-room.mapper';
import { RoomNightState } from './models/room-night-state.enum';
import { RoomNight } from './models/room-night.schema';
import { Room, type RoomDocument } from './models/room.schema';
import {
  coversNight,
  findOverlap,
  nightCount,
  nightsOf,
  sortRanges,
  todayUtc,
  type DateRange,
} from './room-dates';

/** How many nights an error message names before it says "and N more". */
const NIGHTS_IN_MESSAGE = 5;

/** The fields of a room that HTL-05 lets a moderator change. */
const EDITABLE_FIELDS = ['beds', 'maxOccupancy', 'pricePerNight'] as const;

/** MongoDB's error code for a value that breaks a unique index. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/** "2026-12-03, 2026-12-04 and 3 more" */
const listNights = (nights: readonly string[]): string => {
  const named = nights.slice(0, NIGHTS_IN_MESSAGE).join(', ');
  const rest = nights.length - NIGHTS_IN_MESSAGE;
  return rest > 0 ? `${named} and ${rest} more` : named;
};

/** 400 when two ranges of one list share a night. */
const assertNoOverlap = (label: string, ranges: readonly DateRange[]): void => {
  const overlap = findOverlap(ranges);
  if (overlap) {
    const [first, second] = overlap;
    throw new BadRequestException(
      `${label} ranges must not overlap: ${first.from} to ${first.to} and ${second.from} to ${second.to}`,
    );
  }
};

/**
 * The rooms of a hotel, managed by its moderator: edit (HTL-05), block dates,
 * deactivate, reactivate and delete (HTL-06).
 */
@Injectable()
export class HotelRoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
    private readonly hotelsService: HotelsService,
    private readonly bookingLookup: HotelBookingLookup,
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
  ): Promise<ManagedRoomResponseDto> {
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

    return this.toResponse(room);
  }

  /**
   * HTL-05 and HTL-06: replaces the bookable date ranges of a room, its
   * blocked date ranges, or both. A night that a reservation holds or has
   * booked must stay bookable and cannot be blocked.
   */
  async setAvailability(
    hotelId: string,
    roomId: string,
    dto: SetRoomAvailabilityDto,
    userId: string,
  ): Promise<ManagedRoomResponseDto> {
    const { availability, blocked } = dto;
    if (availability === undefined && blocked === undefined) {
      throw new BadRequestException('Send availability, blocked or both');
    }
    if (availability) {
      assertNoOverlap('Availability', availability);
    }
    let wantedBlocks: string[] | undefined;
    if (blocked) {
      assertNoOverlap('Blocked', blocked);
      const total = blocked.reduce((sum, range) => sum + nightCount(range), 0);
      if (total > ROOM_BLOCK_MAX_NIGHTS) {
        throw new BadRequestException(
          `A request can block at most ${ROOM_BLOCK_MAX_NIGHTS} nights`,
        );
      }
      wantedBlocks = blocked.flatMap(nightsOf);
    }

    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);
    const reserved = await this.reservedNightsOf(room);

    let ranges: DateRange[] | undefined;
    if (availability) {
      ranges = sortRanges(availability).map(({ from, to }) => ({ from, to }));
      const stranded = reserved.filter((date) => !coversNight(ranges!, date));
      if (stranded.length > 0) {
        throw new ConflictException(
          `Availability cannot be removed for nights with a reservation: ${listNights(stranded)}`,
        );
      }
    }

    if (wantedBlocks) {
      const wanted = new Set(wantedBlocks);
      const clash = reserved.filter((date) => wanted.has(date));
      if (clash.length > 0) {
        throw new ConflictException(
          `Nights with a reservation cannot be blocked: ${listNights(clash)}`,
        );
      }
      await this.replaceBlocks(room, wantedBlocks);
    }

    if (ranges) {
      room.availability = ranges;
      await room.save();
    }

    return this.toResponse(room);
  }

  /**
   * HTL-06: takes a room out of search. A room with an upcoming reservation
   * (Confirmed, or Pending Payment with a hold that has not expired) cannot be
   * deactivated; past stays do not count.
   */
  async deactivate(
    hotelId: string,
    roomId: string,
    userId: string,
  ): Promise<ManagedRoomResponseDto> {
    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);
    if (!room.active) {
      throw new ConflictException('The room is already deactivated');
    }

    const today = todayUtc();
    const upcoming = (await this.reservedNightsOf(room)).filter(
      (date) => date >= today,
    );
    if (upcoming.length > 0) {
      throw new ConflictException(
        `A room with upcoming reservations cannot be deactivated: ${listNights(upcoming)}`,
      );
    }

    room.active = false;
    await room.save();

    return this.toResponse(room);
  }

  /** HTL-06: makes a deactivated room bookable again. */
  async reactivate(
    hotelId: string,
    roomId: string,
    userId: string,
  ): Promise<ManagedRoomResponseDto> {
    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);
    if (room.active) {
      throw new ConflictException('The room is already active');
    }

    room.active = true;
    await room.save();

    return this.toResponse(room);
  }

  /**
   * HTL-06: deletes a room that has never been reserved. A room night with a
   * reservation, in any state, means the room was reserved; such a room can
   * only be deactivated. So does a reservation that names the room: the
   * nights of an expired one are released (HTL-18), but it was reserved.
   */
  async remove(hotelId: string, roomId: string, userId: string): Promise<void> {
    const room = await this.findManagedRoomOrThrow(hotelId, roomId, userId);

    const reserved =
      (await this.roomNights
        .exists({ roomId: room._id, bookingId: { $exists: true } })
        .exec()) !== null ||
      (await this.bookingLookup.wasEverReserved(room.hotelId, room._id));
    if (reserved) {
      throw new ConflictException(
        'A room that has been reserved cannot be deleted. Deactivate it instead.',
      );
    }

    // The room's own blocks go with it: nothing else refers to them.
    await this.roomNights
      .deleteMany({ roomId: room._id, state: RoomNightState.Blocked })
      .exec();
    await this.rooms.deleteOne({ _id: room._id }).exec();
  }

  /**
   * Makes the blocked nights of a room exactly `wanted`. New blocks are
   * inserted, and the unique (`roomId`, `date`) index refuses a night that a
   * reservation took in the meantime; blocks that are no longer wanted are
   * removed by id.
   */
  private async replaceBlocks(
    room: RoomDocument,
    wanted: readonly string[],
  ): Promise<void> {
    const existing = await this.roomNights
      .find({ roomId: room._id, state: RoomNightState.Blocked })
      .select('date')
      .lean()
      .exec();
    const existingDates = new Set(existing.map((night) => night.date));
    const wantedDates = new Set(wanted);
    const toAdd = wanted.filter((date) => !existingDates.has(date));
    const toRemove = existing
      .filter((night) => !wantedDates.has(night.date))
      .map((night) => night._id);

    if (toAdd.length > 0) {
      // A hold that has expired no longer counts and is removed before the
      // night is reused, as the spec says for every new hold.
      await this.roomNights
        .deleteMany({
          roomId: room._id,
          date: { $in: toAdd },
          state: RoomNightState.Held,
          holdExpiresAt: { $lte: new Date() },
        })
        .exec();

      const nights = toAdd.map((date) => ({
        _id: new Types.ObjectId(),
        roomId: room._id,
        hotelId: room.hotelId,
        date,
        state: RoomNightState.Blocked,
      }));
      try {
        await this.roomNights.insertMany(nights);
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
        // A reservation took one of the nights after the check. Undo only the
        // nights this request inserted, found by the ids it chose itself.
        await this.roomNights
          .deleteMany({
            _id: { $in: nights.map((night) => night._id) },
            state: RoomNightState.Blocked,
          })
          .exec();
        throw new ConflictException(
          'A reservation took one of these nights while they were being blocked. Please try again.',
        );
      }
    }

    if (toRemove.length > 0) {
      await this.roomNights
        .deleteMany({
          _id: { $in: toRemove },
          state: RoomNightState.Blocked,
        })
        .exec();
    }
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

  /** The room with its blocked nights, for the response. */
  private async toResponse(
    room: RoomDocument,
  ): Promise<ManagedRoomResponseDto> {
    const blocked = await this.roomNights
      .find({ roomId: room._id, state: RoomNightState.Blocked })
      .select('date')
      .sort({ date: 1 })
      .lean()
      .exec();

    return toManagedRoomResponse(
      room,
      blocked.map((night) => night.date),
    );
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
