import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  HotelAvailableRoomsService,
  type FreeRoom,
  type Stay,
} from './hotel-available-rooms.service';
import { Hotel } from './models/hotel.schema';
import { RoomNightState } from './models/room-night-state.enum';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import { nightsOf } from './room-dates';

/** MongoDB's error code for a value that breaks a unique index. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/** The hotel facts a reservation copies when it is made (HTL-16). */
export type BookableHotel = Pick<Hotel, 'name' | 'policy'> & {
  _id: Types.ObjectId;
};

/** One room a reservation asks for, with the number of guests in it. */
export interface RoomRequest {
  roomId: string;
  guests: number;
}

/** The hotel and the requested rooms, in the order they were asked for. */
export interface BookableRooms {
  hotel: BookableHotel;
  rooms: FreeRoom[];
}

export const HOTEL_NOT_BOOKABLE_MESSAGE = 'Hotel not found';
export const ROOMS_TAKEN_MESSAGE =
  'One of the rooms was taken by someone else a moment ago. Nothing was held; please search again.';

/** "101, 102" */
const listNumbers = (numbers: readonly string[]): string =>
  [...numbers].sort().join(', ');

/**
 * HTL-16 and HTL-18: the hotel side of a reservation. The hotel-bookings
 * module owns the reservation; this module owns the rooms and their nights,
 * so the reservation finds and holds rooms only through this service.
 */
@Injectable()
export class HotelRoomHoldsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
    private readonly availableRooms: HotelAvailableRoomsService,
  ) {}

  /**
   * The active hotel and the requested rooms, checked in this order:
   * - 400 for a check-in in the past or a stay of more than 366 nights;
   * - 404 when the hotel does not exist or is deactivated, or a room is not
   *   a room of this hotel;
   * - 400 when a room's guests exceed its maximum occupancy (HTL-16);
   * - 409 when a room is not free for the whole stay: deactivated, outside
   *   its availability, or a night is booked, blocked or held (HTL-18).
   *
   * Reading is not holding: the rooms can still be taken before `hold`.
   */
  async findBookableRooms(
    hotelId: string,
    requested: readonly RoomRequest[],
    stay: Stay,
  ): Promise<BookableRooms> {
    this.availableRooms.assertStay(stay);

    const hotel = await this.hotels
      .findOne({ _id: hotelId, active: true })
      .select('name policy')
      .lean()
      .exec();
    if (!hotel) {
      throw new NotFoundException(HOTEL_NOT_BOOKABLE_MESSAGE);
    }

    // The same spelling as `ObjectId#toString()`, so the lookups below match.
    const ids = requested.map((request) => new Types.ObjectId(request.roomId));
    const requests = requested.map((request, index) => ({
      ...request,
      roomId: ids[index].toString(),
    }));
    const known = await this.rooms
      .find({ _id: { $in: ids }, hotelId: hotel._id })
      .select('number maxOccupancy')
      .lean()
      .exec();
    const knownById = new Map(known.map((room) => [room._id.toString(), room]));
    const unknown = requests.filter(
      (request) => !knownById.has(request.roomId),
    );
    if (unknown.length > 0) {
      throw new NotFoundException(
        `These rooms are not rooms of this hotel: ${unknown
          .map((request) => request.roomId)
          .join(', ')}`,
      );
    }

    const crowded = requests.flatMap((request) => {
      const room = knownById.get(request.roomId);
      return room && request.guests > room.maxOccupancy
        ? [`room ${room.number} holds at most ${room.maxOccupancy}`]
        : [];
    });
    if (crowded.length > 0) {
      throw new BadRequestException(
        `Too many guests for a room: ${crowded.join('; ')}`,
      );
    }

    const free = await this.availableRooms.findFreeRoomEntities(
      hotel._id,
      stay,
    );
    const freeById = new Map(free.map((room) => [room._id.toString(), room]));
    const rooms = requests.flatMap((request) => {
      const room = freeById.get(request.roomId);
      return room ? [room] : [];
    });
    if (rooms.length !== requests.length) {
      const taken = known
        .filter((room) => !freeById.has(room._id.toString()))
        .map((room) => room.number);
      throw new ConflictException(
        `Not free for the whole stay: room ${listNumbers(taken)}. Nothing was held.`,
      );
    }

    return { hotel, rooms };
  }

  /**
   * HTL-18: holds every night of the stay in every room for the reservation,
   * all or nothing. The unique (`roomId`, `date`) index decides who gets a
   * night. If any night is already taken, the nights this call inserted are
   * deleted again (found by the ids it chose itself) and the answer is 409.
   *
   * No transaction: the CI database is a single MongoDB server, which has
   * none, so the fallback of the spec is the only path. It is safe because
   * every held night carries `holdExpiresAt`: even a night left behind by a
   * crash stops counting when the hold expires.
   */
  async hold(
    hotelId: Types.ObjectId,
    roomIds: readonly Types.ObjectId[],
    stay: Stay,
    bookingId: Types.ObjectId,
    holdExpiresAt: Date,
  ): Promise<void> {
    // A hold that has expired no longer counts and is removed before the
    // night is reused, as the spec says for every new hold.
    await this.roomNights
      .deleteMany({
        roomId: { $in: roomIds },
        date: { $gte: stay.from, $lt: stay.to },
        state: RoomNightState.Held,
        holdExpiresAt: { $lte: new Date() },
      })
      .exec();

    const dates = nightsOf(stay);
    const nights = roomIds.flatMap((roomId) =>
      dates.map((date) => ({
        _id: new Types.ObjectId(),
        roomId,
        hotelId,
        date,
        state: RoomNightState.Held,
        bookingId,
        holdExpiresAt,
      })),
    );

    try {
      await this.roomNights.insertMany(nights);
    } catch (error) {
      await this.roomNights
        .deleteMany({
          _id: { $in: nights.map((night) => night._id) },
          bookingId,
          state: RoomNightState.Held,
        })
        .exec();
      if (isDuplicateKey(error)) {
        throw new ConflictException(ROOMS_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Frees the nights a reservation holds (HTL-18): when its hold expires,
   * or when the reservation could not be saved after the hold. Booked and
   * blocked nights are never touched.
   */
  async release(bookingId: Types.ObjectId): Promise<void> {
    await this.roomNights
      .deleteMany({ bookingId, state: RoomNightState.Held })
      .exec();
  }
}
