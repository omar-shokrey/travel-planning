import type { Types } from 'mongoose';
import { RoomNightState } from './models/room-night-state.enum';
import { coversNight, nightsOf, type DateRange } from './room-dates';

/*
 * The free-room rule of the module, used by hotel search (HTL-11) and the
 * available rooms of a hotel (HTL-15). A room is free for a stay when it is
 * active (HTL-06), its availability (HTL-04) covers every night, and no night
 * is blocked, booked or held by a hold that has not expired (HTL-18). The
 * database does the first part with `roomsThatCanBeFree` and reads the
 * nights with `nightsOfTheStay`; `isFreeForStay` decides the rest. A caller
 * must use all three, so the routes cannot disagree.
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
