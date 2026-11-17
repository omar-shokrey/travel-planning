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

/** HTL-12: what the search results can be sorted by. */
export enum HotelSearchSort {
  /** By hotel name, A to Z (the default). */
  Name = 'name',
  /** By the price per night of the cheapest free room. */
  Price = 'price',
  /** By average rating. */
  Rating = 'rating',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

/** The fields of a search result that HTL-12 filters and sorts on. */
export interface SearchCandidate {
  cheapestPricePerNight: number;
  averageRating: number;
}

/** HTL-12: whether the price is inside the inclusive range that was sent. */
export function inPriceRange(
  price: number,
  minPrice?: number,
  maxPrice?: number,
): boolean {
  return (
    (minPrice === undefined || price >= minPrice) &&
    (maxPrice === undefined || price <= maxPrice)
  );
}

/** The order a sort uses when none is sent: cheapest first, best rated first. */
export function defaultOrder(sort: HotelSearchSort): SortOrder {
  return sort === HotelSearchSort.Rating ? SortOrder.Desc : SortOrder.Asc;
}

/**
 * HTL-12: the candidates sorted by price or rating. The list must already be
 * sorted by name: the sort is stable, so equal prices or ratings stay in name
 * order. Sorting by name returns the list as it is (or reversed for `desc`).
 */
export function sortCandidates<T extends SearchCandidate>(
  candidates: readonly T[],
  sort: HotelSearchSort,
  order: SortOrder = defaultOrder(sort),
): T[] {
  const direction = order === SortOrder.Asc ? 1 : -1;
  if (sort === HotelSearchSort.Name) {
    return direction === 1 ? [...candidates] : [...candidates].reverse();
  }
  const key = (candidate: T): number =>
    sort === HotelSearchSort.Price
      ? candidate.cheapestPricePerNight
      : candidate.averageRating;
  return [...candidates].sort((a, b) => (key(a) - key(b)) * direction);
}
