import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  groupNightsByRoom,
  isFreeForStay,
  nightsOfTheStay,
  roomsThatCanBeFree,
  STAY_NIGHT_FIELDS,
} from './hotel-search';
import { Hotel } from './models/hotel.schema';
import { RoomNightState } from './models/room-night-state.enum';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import { nightsOf, type DateRange } from './room-dates';
import { assertStay, invalid } from './stay-rules';

/** MongoDB's error code for a value that breaks a unique index. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/** The room fields a reservation reads and copies. */
const ROOM_FIELDS = 'number type maxOccupancy pricePerNight availability';

export const HOTEL_NOT_BOOKABLE_MESSAGE = 'Hotel not found';
export const ROOMS_TAKEN_MESSAGE =
  'A room was taken by someone else a moment ago, or is no longer available. Nothing was held; please search again.';

/** The hotel facts a reservation copies when it is made (HTL-16). */
export type BookableHotel = Pick<Hotel, 'name' | 'policy'> & {
  _id: Types.ObjectId;
};

/** A room of the hotel as a reservation needs it. */
export type BookableRoom = Pick<
  Room,
  'number' | 'type' | 'maxOccupancy' | 'pricePerNight'
> & { _id: Types.ObjectId };

/** One room a reservation asks for, with the number of guests in it. */
export interface RoomRequest {
  roomId: string;
  guests: number;
}

/** The hotel and the requested rooms, in the order they were asked for. */
export interface BookableRooms {
  hotel: BookableHotel;
  rooms: BookableRoom[];
}

/** "101, 102" */
const listNumbers = (numbers: readonly string[]): string =>
  [...numbers].sort().join(', ');

/**
 * HTL-16 and HTL-18: the hotel side of a reservation. The hotel-bookings
 * module owns the reservation; this module owns the rooms and their nights
 * (`room_nights`), so a reservation finds and holds rooms only through this
 * service. Which rooms are free is decided by the one rule of `hotel-search.ts`
 * that hotel search (HTL-11) and the free rooms of a hotel (HTL-15) use.
 */
@Injectable()
export class HotelRoomHoldsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
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
   * Reading is not holding: a room can still be taken before `hold`.
   */
  async findBookableRooms(
    hotelId: string,
    requested: readonly RoomRequest[],
    stay: DateRange,
    now: Date = new Date(),
  ): Promise<BookableRooms> {
    assertStay(stay);

    const hotel = await this.hotels
      .findOne({ _id: hotelId, active: true })
      .select('name policy')
      .lean()
      .exec();
    if (!hotel) {
      throw new NotFoundException(HOTEL_NOT_BOOKABLE_MESSAGE);
    }

    // The same spelling as `ObjectId#toString()`, so the lookups below match
    // whatever letter case the client used.
    const ids = requested.map((request) => new Types.ObjectId(request.roomId));
    const wanted = requested.map((request, index) => ({
      ...request,
      key: ids[index].toString(),
    }));
    const known = await this.rooms
      .find({ _id: { $in: ids }, hotelId: hotel._id })
      .select(ROOM_FIELDS)
      .lean()
      .exec();
    const knownById = new Map(known.map((room) => [room._id.toString(), room]));

    const unknown = wanted.filter((item) => !knownById.has(item.key));
    if (unknown.length > 0) {
      throw new NotFoundException(
        `These rooms are not rooms of this hotel: ${unknown
          .map((item) => item.roomId)
          .join(', ')}`,
      );
    }

    const crowded = wanted.flatMap((item) => {
      const room = knownById.get(item.key);
      return room && item.guests > room.maxOccupancy
        ? [`room ${room.number} holds at most ${room.maxOccupancy}`]
        : [];
    });
    if (crowded.length > 0) {
      throw invalid(
        'rooms',
        `Too many guests for a room: ${crowded.join('; ')}`,
      );
    }

    // The free-room rule of hotel search: the database reads the active rooms
    // bookable on the first night and their nights, `isFreeForStay` decides.
    const candidates = await this.rooms
      .find({
        _id: { $in: ids },
        hotelId: hotel._id,
        ...roomsThatCanBeFree(stay),
      })
      .select(ROOM_FIELDS)
      .lean()
      .exec();
    const nights =
      candidates.length === 0
        ? []
        : await this.roomNights
            .find(
              nightsOfTheStay(
                candidates.map((room) => room._id),
                stay,
              ),
            )
            .select(STAY_NIGHT_FIELDS)
            .lean()
            .exec();
    const nightsByRoom = groupNightsByRoom(nights);
    const freeIds = new Set(
      candidates
        .filter((room) =>
          isFreeForStay(
            room,
            stay,
            nightsByRoom.get(room._id.toString()) ?? [],
            now,
          ),
        )
        .map((room) => room._id.toString()),
    );
    const notFree = known
      .filter((room) => !freeIds.has(room._id.toString()))
      .map((room) => room.number);
    if (notFree.length > 0) {
      throw new ConflictException(
        `Not free for the whole stay: room ${listNumbers(notFree)}. Nothing was held.`,
      );
    }

    return {
      hotel,
      rooms: wanted.flatMap((item) => {
        const room = knownById.get(item.key);
        return room ? [room] : [];
      }),
    };
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
   *
   * After the nights are written the hotel and the rooms are read again
   * (write first, then verify): a room may have been deactivated, deleted or
   * cut out of its availability between `findBookableRooms` and now (HTL-05,
   * HTL-06). If so, only this call's nights are released and the answer is 409.
   */
  async hold(
    hotelId: Types.ObjectId,
    roomIds: readonly Types.ObjectId[],
    stay: DateRange,
    bookingId: Types.ObjectId,
    holdExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    // A hold that has expired no longer counts and is removed before the
    // night is reused, as the spec says for every new hold.
    await this.roomNights
      .deleteMany({
        roomId: { $in: [...roomIds] },
        date: { $gte: stay.from, $lt: stay.to },
        state: RoomNightState.Held,
        holdExpiresAt: { $lte: now },
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

    let stillBookable: boolean;
    try {
      stillBookable = await this.stillBookable(hotelId, roomIds, stay, now);
    } catch (error) {
      await this.release(bookingId);
      throw error;
    }
    if (!stillBookable) {
      await this.release(bookingId);
      throw new ConflictException(ROOMS_TAKEN_MESSAGE);
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

  /**
   * HTL-17: keeps the reservation's held nights from expiring while it is
   * being confirmed after payment. Only nights this reservation holds with a
   * hold that is still live at `now` get the later `until`; nothing else is
   * touched. Without it, a payment in the last moments of the hold could be
   * confirmed just as the nights expire, and another reservation's `hold`
   * would then remove them (an expired hold no longer counts). Returns how
   * many nights were kept.
   */
  async secureHold(
    bookingId: Types.ObjectId,
    until: Date,
    now: Date,
  ): Promise<number> {
    const { modifiedCount } = await this.roomNights
      .updateMany(
        {
          bookingId,
          state: RoomNightState.Held,
          holdExpiresAt: { $gt: now },
        },
        { $set: { holdExpiresAt: until } },
      )
      .exec();
    return modifiedCount;
  }

  /**
   * HTL-17: the nights a confirmed reservation holds become booked: state
   * `booked` and no `holdExpiresAt`, so they never expire and the free-room
   * rule always counts them as taken. Only this reservation's held nights
   * are changed, never a broad filter. Running it again changes nothing.
   * Returns how many nights became booked.
   */
  async confirm(bookingId: Types.ObjectId): Promise<number> {
    const { modifiedCount } = await this.roomNights
      .updateMany(
        { bookingId, state: RoomNightState.Held },
        {
          $set: { state: RoomNightState.Booked },
          $unset: { holdExpiresAt: '' },
        },
      )
      .exec();
    return modifiedCount;
  }

  /**
   * Whether the hotel is still active and every room still exists, is active
   * and has the whole stay inside its availability. The nights are this
   * call's own by now, so only the availability is left to check.
   */
  private async stillBookable(
    hotelId: Types.ObjectId,
    roomIds: readonly Types.ObjectId[],
    stay: DateRange,
    now: Date,
  ): Promise<boolean> {
    const hotel = await this.hotels
      .exists({ _id: hotelId, active: true })
      .exec();
    if (!hotel) return false;

    const rooms = await this.rooms
      .find({
        _id: { $in: [...roomIds] },
        hotelId,
        ...roomsThatCanBeFree(stay),
      })
      .select('maxOccupancy pricePerNight availability')
      .lean()
      .exec();
    return (
      rooms.length === roomIds.length &&
      rooms.every((room) => isFreeForStay(room, stay, [], now))
    );
  }
}
