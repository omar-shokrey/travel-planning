/** What the search rule needs of a free room. */
export interface SearchRoom {
  maxOccupancy: number;
  pricePerNight: number;
}

/**
 * HTL-11: whether a hotel's free rooms can host the search. It needs at least
 * `rooms` free rooms whose combined maximum occupancy covers `guests`. The
 * best choice is the `rooms` largest rooms, so the hotel qualifies exactly
 * when their occupancies add up to `guests` or more.
 */
export function canHost(
  freeRooms: readonly SearchRoom[],
  rooms: number,
  guests: number,
): boolean {
  if (freeRooms.length < rooms) {
    return false;
  }
  const largest = freeRooms
    .map((room) => room.maxOccupancy)
    .sort((a, b) => b - a)
    .slice(0, rooms);
  return largest.reduce((sum, occupancy) => sum + occupancy, 0) >= guests;
}

/** The price per night of the cheapest free room (HTL-11, HTL-12). */
export function cheapestPricePerNight(
  freeRooms: readonly SearchRoom[],
): number {
  return Math.min(...freeRooms.map((room) => room.pricePerNight));
}
