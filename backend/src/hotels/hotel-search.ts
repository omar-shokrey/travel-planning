import { RoomNightState } from './models/room-night-state.enum';
import { coversNight, nightsOf, type DateRange } from './room-dates';

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
 * HTL-11: whether a room is free for the whole stay: every night is inside an
 * availability range (HTL-04) and no night is taken.
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
