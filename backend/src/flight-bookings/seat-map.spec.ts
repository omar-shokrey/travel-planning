import { CABIN_SEATS_MAX } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { SEAT_LAYOUTS, SEAT_NUMBER_PATTERN, buildSeatMap } from './seat-map';

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
    expect(buildSeatMap(CabinClass.Business, 6)).toEqual([
      '1A',
      '1C',
      '1D',
      '1F',
      '2A',
      '2C',
    ]);
  });

  it('gives a single seat for a cabin of one seat', () => {
    expect(buildSeatMap(CabinClass.First, 1)).toEqual(['1A']);
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

  it('starts every cabin at row 1, so a change in one cabin never moves the seats of another', () => {
    // A chosen seat is stored by its label and its cabin: changing a layout
    // would move every stored seat of that cabin.
    for (const cabin of CABINS) {
      expect(buildSeatMap(cabin, 1)).toEqual(['1A']);
    }
  });

  it('uses each cabin’s own layout', () => {
    for (const cabin of CABINS) {
      const row = buildSeatMap(cabin, SEAT_LAYOUTS[cabin].length);
      expect(row.map((seat) => seat.slice(-1)).join('')).toBe(
        SEAT_LAYOUTS[cabin],
      );
    }
  });

  it('keeps the largest cabin within the seat label format (at most 500 rows)', () => {
    const first = buildSeatMap(CabinClass.First, CABIN_SEATS_MAX);

    expect(first[first.length - 1]).toBe('500F');
  });
});
