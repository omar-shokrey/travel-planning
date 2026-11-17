import { canHost, cheapestPricePerNight } from './hotel-search';

const room = (maxOccupancy: number, pricePerNight = 10000) => ({
  maxOccupancy,
  pricePerNight,
});

describe('canHost (HTL-11)', () => {
  it('needs at least as many free rooms as asked', () => {
    expect(canHost([room(4)], 2, 2)).toBe(false);
    expect(canHost([room(4), room(1)], 2, 2)).toBe(true);
  });

  it('needs the combined occupancy of the rooms to cover the guests', () => {
    expect(canHost([room(2)], 1, 2)).toBe(true);
    expect(canHost([room(2)], 1, 3)).toBe(false);
  });

  it('counts the largest rooms, whatever their order', () => {
    // Two rooms for 5 guests: 3 + 2 fits, although 1 + 2 would not.
    expect(canHost([room(1), room(2), room(3)], 2, 5)).toBe(true);
    expect(canHost([room(1), room(2), room(3)], 2, 6)).toBe(false);
  });

  it('refuses a hotel with no free room', () => {
    expect(canHost([], 1, 1)).toBe(false);
  });
});

describe('cheapestPricePerNight (HTL-11)', () => {
  it('returns the lowest price of the free rooms', () => {
    expect(
      cheapestPricePerNight([room(2, 15000), room(3, 9000), room(1, 12000)]),
    ).toBe(9000);
  });
});
