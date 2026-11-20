import type { Types } from 'mongoose';
import type { HotelSearchSort, HotelSearchSortOrder } from './hotels.constants';
import { RoomNightState } from './models/room-night-state.enum';
import { coversNight, nightsOf, type DateRange } from './room-dates';

/*
 * The free-room rule of the module, used by hotel search (HTL-11) and the
 * available rooms of a hotel (HTL-15). A room is free for a stay when it is
 * active (HTL-06), its availability (HTL-04) covers every night, and no night
 * is blocked, booked or held by a hold that has not expired (HTL-18). The
 * database does the first part with `roomsThatCanBeFree` and reads the
 * nights with `nightsOfTheStay`; `groupNightsByRoom` gives each room its
 * nights, and `isFreeForStay` decides the rest. A caller must use all four,
 * so the routes cannot disagree.
 */

/**
 * The `rooms` filter of the rule: active rooms (HTL-06) bookable on the first
 * night. Add the hotel (or hotels) to it. Rooms that miss a later night are
 * left out by `isFreeForStay`.
 */
export function roomsThatCanBeFree(stay: DateRange): {
  active: true;
  availability: {
    $elemMatch: { from: { $lte: string }; to: { $gt: string } };
  };
} {
  return {
    active: true,
    availability: {
      $elemMatch: { from: { $lte: stay.from }, to: { $gt: stay.from } },
    },
  };
}

/**
 * The `room_nights` filter of the rule: the nights of these rooms from
 * check-in up to the day before check-out. The check-out day is not a night
 * of the stay, so it is never read.
 */
export function nightsOfTheStay(
  roomIds: readonly Types.ObjectId[],
  stay: DateRange,
): {
  roomId: { $in: Types.ObjectId[] };
  date: { $gte: string; $lt: string };
} {
  return {
    roomId: { $in: [...roomIds] },
    date: { $gte: stay.from, $lt: stay.to },
  };
}

/** The `room_nights` fields `isFreeForStay` needs, plus the room id. */
export const STAY_NIGHT_FIELDS = 'roomId date state holdExpiresAt';

/**
 * The nights read with `nightsOfTheStay`, by room id, each list in the order
 * read: `isFreeForStay` takes one room's list. Each night is appended to its
 * room's list, so the work grows with the number of nights, not its square.
 */
export function groupNightsByRoom<N extends { roomId: Types.ObjectId }>(
  nights: readonly N[],
): Map<string, N[]> {
  const byRoom = new Map<string, N[]>();
  for (const night of nights) {
    const key = night.roomId.toString();
    const list = byRoom.get(key);
    if (list) {
      list.push(night);
    } else {
      byRoom.set(key, [night]);
    }
  }
  return byRoom;
}

/** A room as much as the search needs. */
export interface SearchRoom {
  maxOccupancy: number;
  pricePerNight: number;
  availability: readonly DateRange[];
}

/** A stored `room_nights` document of one room, as much as the search needs. */
export interface SearchNight {
  date: string;
  state: RoomNightState;
  holdExpiresAt?: Date;
}

/**
 * Whether a night document makes the room not free: blocked, booked, or held
 * by a hold that has not expired (HTL-18). An expired hold no longer counts,
 * as in every other query of the module.
 */
export function takesTheNight(night: SearchNight, now: Date): boolean {
  if (night.state !== RoomNightState.Held) return true;
  return night.holdExpiresAt !== undefined && night.holdExpiresAt > now;
}

/**
 * HTL-11, HTL-15: whether a room read with `roomsThatCanBeFree` is free for
 * the whole stay: every night is inside an availability range (HTL-04) and
 * none of its `nights` (read with `nightsOfTheStay`) is taken.
 */
export function isFreeForStay(
  room: SearchRoom,
  stay: DateRange,
  nights: readonly SearchNight[],
  now: Date,
): boolean {
  if (nights.some((night) => takesTheNight(night, now))) return false;
  return nightsOf(stay).every((date) => coversNight(room.availability, date));
}

/**
 * HTL-11: whether the free rooms of a hotel can take the search: at least
 * `rooms` of them, and the `rooms` largest together hold all the guests. The
 * largest ones are the best choice, so if they cannot, no choice can.
 */
export function canHost(
  freeRooms: readonly SearchRoom[],
  rooms: number,
  guests: number,
): boolean {
  if (freeRooms.length < rooms) return false;
  const largest = freeRooms
    .map((room) => room.maxOccupancy)
    .sort((a, b) => b - a)
    .slice(0, rooms);
  return largest.reduce((sum, occupancy) => sum + occupancy, 0) >= guests;
}

/** HTL-12: what the filters and the order read of a search result. */
export interface RankedHotel {
  lowestPricePerNight: number;
  ratingCount: number;
  averageRating: number;
}

/** HTL-12: the optional filters of a search. */
export interface HotelSearchFilters {
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
}

/**
 * HTL-12: whether a result passes the filters. The price is the result's
 * `lowestPricePerNight`, the cheapest room free for the stay: a hotel whose
 * cheapest room is below the range is left out even if a dearer room of it is
 * inside, so a listed hotel always shows a price inside the range. Both ends
 * are inclusive. With `minRating`, a hotel with no rating yet is left out;
 * without it, it stays.
 */
export function passesFilters(
  hotel: RankedHotel,
  filters: HotelSearchFilters,
): boolean {
  if (
    filters.minPrice !== undefined &&
    hotel.lowestPricePerNight < filters.minPrice
  ) {
    return false;
  }
  if (
    filters.maxPrice !== undefined &&
    hotel.lowestPricePerNight > filters.maxPrice
  ) {
    return false;
  }
  if (filters.minRating !== undefined) {
    return hotel.ratingCount > 0 && hotel.averageRating >= filters.minRating;
  }
  return true;
}

/** HTL-12: the direction when none is sent: best first for the rating, else ascending. */
export function defaultSortOrder(
  sortBy: HotelSearchSort,
): HotelSearchSortOrder {
  return sortBy === 'rating' ? 'desc' : 'asc';
}

/**
 * HTL-12: the results in the order asked. `byName` must be in the name order
 * of HTL-11 (collation en, then `_id`), as the hotels are read; that order
 * breaks every tie, in both directions, so the order is the same on every
 * page. For `rating`, hotels with no rating yet come last in both
 * directions. Returns a new array.
 */
export function sortResults<T extends RankedHotel>(
  byName: readonly T[],
  sortBy: HotelSearchSort,
  sortOrder: HotelSearchSortOrder,
): T[] {
  const sign = sortOrder === 'asc' ? 1 : -1;
  const ranked = byName.map((hotel, position) => ({ hotel, position }));
  const compare = (
    a: { hotel: T; position: number },
    b: { hotel: T; position: number },
  ): number => {
    if (sortBy === 'price') {
      const diff = a.hotel.lowestPricePerNight - b.hotel.lowestPricePerNight;
      return diff !== 0 ? sign * diff : a.position - b.position;
    }
    if (sortBy === 'rating') {
      const aRated = a.hotel.ratingCount > 0;
      const bRated = b.hotel.ratingCount > 0;
      if (aRated !== bRated) return aRated ? -1 : 1;
      const diff = aRated ? a.hotel.averageRating - b.hotel.averageRating : 0;
      return diff !== 0 ? sign * diff : a.position - b.position;
    }
    return sign * (a.position - b.position);
  };
  return ranked.sort(compare).map(({ hotel }) => hotel);
}
