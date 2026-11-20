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

/** A seat label: a row number and a seat letter, for example `12C`. */
export const SEAT_NUMBER_PATTERN = /^[1-9]\d{0,3}[A-Z]$/;

/**
 * FLT-28: every seat of a cabin with `totalSeats` seats, in order: row by row
 * from row 1, each row in the letters of the cabin's layout. It returns
 * exactly `totalSeats` different labels (the last row may be partial) and
 * always the same ones for the same input.
 *
 * Every cabin starts at row 1, so `1A` exists in economy and in business: a
 * seat is always named with its cabin (the booked cabin of the segment, and
 * the unique index is per flight and cabin). Why not rows that continue
 * from one cabin to the next: a moderator may change a cabin's seat count
 * (FLT-05), which would move every chosen seat of the cabins after it onto
 * another seat. A cabin that grows keeps its first seats.
 */
export function buildSeatMap(cabin: CabinClass, totalSeats: number): string[] {
  const letters = SEAT_LAYOUTS[cabin];
  const count = Math.max(0, Math.floor(totalSeats));
  return Array.from(
    { length: count },
    (_, index) =>
      `${1 + Math.floor(index / letters.length)}${letters[index % letters.length]}`,
  );
}
