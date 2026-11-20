import { CABIN_SEATS_MAX } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';

/**
 * FLT-28: the seat letters of one row of each cabin, window to window. A
 * cabin's seats are labels only: they are not stored on the flight, and
 * choosing one never changes the seat counters (FLT-22).
 */
export const SEAT_LAYOUTS: Readonly<Record<CabinClass, string>> = {
  [CabinClass.Economy]: 'ABCDEF',
  [CabinClass.PremiumEconomy]: 'ABCDEFG',
  [CabinClass.Business]: 'ACDF',
  [CabinClass.First]: 'AF',
};

/** The cabins in the order of the CabinClass enum: the order of the rows. */
const CABIN_ORDER: readonly CabinClass[] = Object.values(CabinClass);

/** A seat label: a row number and a seat letter, for example `12C`. */
export const SEAT_NUMBER_PATTERN = /^[1-9]\d{0,3}[A-Z]$/;

/** The most rows a cabin can need: CABIN_SEATS_MAX seats, a full row each time. */
const maxRowsOf = (cabin: CabinClass): number =>
  Math.ceil(CABIN_SEATS_MAX / SEAT_LAYOUTS[cabin].length);

/**
 * The first row of a cabin. The rows of a cabin continue after the rows the
 * cabins before it (enum order) can ever have, not after the rows they have
 * today: if a moderator changes one cabin's seat count (FLT-05), the seats of
 * the other cabins keep their labels, so a chosen seat never moves.
 */
export function firstRowOf(cabin: CabinClass): number {
  let row = 1;
  for (const before of CABIN_ORDER) {
    if (before === cabin) return row;
    row += maxRowsOf(before);
  }
  return row;
}

/**
 * FLT-28: every seat of a cabin with `totalSeats` seats, in order: row by row
 * from the cabin's first row, each row in the letters of its layout. It
 * returns exactly `totalSeats` different labels (the last row may be
 * partial) and always the same ones for the same input.
 */
export function buildSeatMap(cabin: CabinClass, totalSeats: number): string[] {
  const letters = SEAT_LAYOUTS[cabin];
  const first = firstRowOf(cabin);
  const count = Math.max(0, Math.floor(totalSeats));
  return Array.from(
    { length: count },
    (_, index) =>
      `${first + Math.floor(index / letters.length)}${letters[index % letters.length]}`,
  );
}
