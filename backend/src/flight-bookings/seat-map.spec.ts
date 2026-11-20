import { CABIN_SEATS_MAX } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';
import {
  SEAT_LAYOUTS,
  SEAT_NUMBER_PATTERN,
  buildSeatMap,
  firstRowOf,
} from './seat-map';

const CABINS = Object.values(CabinClass);

describe('buildSeatMap (FLT-28)', () => {
  it.each(
    CABINS.flatMap((cabin) =>
      [1, 2, 5, 6, 7, 13, 100, 333, CABIN_SEATS_MAX].map(
        (total) => [cabin, total] as const,
      ),
    ),
  )(
    'gives a %s cabin of %p seats exactly that many different seats',
    (cabin, total) => {
      const seats = buildSeatMap(cabin, total);

      expect(seats).toHaveLength(total);
      expect(new Set(seats).size).toBe(total);
      for (const seat of seats) {
        expect(seat).toMatch(SEAT_NUMBER_PATTERN);
      }
    },
  );

  it('fills each row with the letters of the layout, then starts the next row', () => {
    expect(buildSeatMap(CabinClass.Economy, 8)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
    ]);
  });

  it('leaves the last row partial', () => {
    const seats = buildSeatMap(CabinClass.Business, 6);

    expect(seats.slice(-2)).toEqual([
      `${firstRowOf(CabinClass.Business) + 1}A`,
      `${firstRowOf(CabinClass.Business) + 1}C`,
    ]);
  });

  it('gives a single seat for a cabin of one seat', () => {
    expect(buildSeatMap(CabinClass.First, 1)).toEqual([
      `${firstRowOf(CabinClass.First)}A`,
    ]);
  });

  it('gives no seat for a count of 0 or less', () => {
    expect(buildSeatMap(CabinClass.Economy, 0)).toEqual([]);
    expect(buildSeatMap(CabinClass.Economy, -3)).toEqual([]);
  });

  it('always gives the same seats in the same order', () => {
    expect(buildSeatMap(CabinClass.PremiumEconomy, 50)).toEqual(
      buildSeatMap(CabinClass.PremiumEconomy, 50),
    );
  });

  it('keeps the first seats when the cabin grows (FLT-05 can change the count)', () => {
    const small = buildSeatMap(CabinClass.Economy, 40);
    const large = buildSeatMap(CabinClass.Economy, 90);

    expect(large.slice(0, 40)).toEqual(small);
  });

  it('uses each cabin’s own layout', () => {
    for (const cabin of CABINS) {
      const row = buildSeatMap(cabin, SEAT_LAYOUTS[cabin].length);
      expect(row.map((seat) => seat.slice(-1)).join('')).toBe(
        SEAT_LAYOUTS[cabin],
      );
    }
  });
});

describe('firstRowOf (FLT-28)', () => {
  it('starts economy at row 1', () => {
    expect(firstRowOf(CabinClass.Economy)).toBe(1);
  });

  it('keeps the stored rows of every cabin: economy 1, premium economy 168, business 311, first 561', () => {
    // A chosen seat is stored by its label: changing CABIN_SEATS_MAX, a
    // layout or the CabinClass order would move every stored seat.
    expect(CABINS.map(firstRowOf)).toEqual([1, 168, 311, 561]);
  });

  it('starts each cabin after every row the cabins before it can ever have, in enum order', () => {
    let next = 1;
    for (const cabin of CABINS) {
      expect(firstRowOf(cabin)).toBe(next);
      next += Math.ceil(CABIN_SEATS_MAX / SEAT_LAYOUTS[cabin].length);
    }
  });

  it('never lets two cabins of a flight share a seat, even at the largest size', () => {
    const all = CABINS.flatMap((cabin) => buildSeatMap(cabin, CABIN_SEATS_MAX));

    expect(new Set(all).size).toBe(all.length);
  });
});
