import {
  canHost,
  cheapestPricePerNight,
  HotelSearchSort,
  inPriceRange,
  sortCandidates,
  SortOrder,
} from './hotel-search';

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

describe('inPriceRange (HTL-12)', () => {
  it('includes both limits', () => {
    expect(inPriceRange(9000, 9000, 12000)).toBe(true);
    expect(inPriceRange(12000, 9000, 12000)).toBe(true);
    expect(inPriceRange(8999, 9000, 12000)).toBe(false);
    expect(inPriceRange(12001, 9000, 12000)).toBe(false);
  });

  it('applies only the limits that were sent', () => {
    expect(inPriceRange(1, undefined, 12000)).toBe(true);
    expect(inPriceRange(99999, 9000)).toBe(true);
    expect(inPriceRange(5)).toBe(true);
  });
});

describe('sortCandidates (HTL-12)', () => {
  // Already in name order, as the service reads them.
  const a = { name: 'A', cheapestPricePerNight: 12000, averageRating: 4 };
  const b = { name: 'B', cheapestPricePerNight: 9000, averageRating: 4.5 };
  const c = { name: 'C', cheapestPricePerNight: 9000, averageRating: 0 };

  const names = (list: { name: string }[]) => list.map((item) => item.name);

  it('sorts by price, cheapest first, keeping name order for equal prices', () => {
    expect(names(sortCandidates([a, b, c], HotelSearchSort.Price))).toEqual([
      'B',
      'C',
      'A',
    ]);
  });

  it('sorts by price, most expensive first', () => {
    expect(
      names(sortCandidates([a, b, c], HotelSearchSort.Price, SortOrder.Desc)),
    ).toEqual(['A', 'B', 'C']);
  });

  it('sorts by rating, best first by default', () => {
    expect(names(sortCandidates([a, b, c], HotelSearchSort.Rating))).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('sorts by rating, lowest first', () => {
    expect(
      names(sortCandidates([a, b, c], HotelSearchSort.Rating, SortOrder.Asc)),
    ).toEqual(['C', 'A', 'B']);
  });

  it('keeps the name order, or reverses it', () => {
    expect(names(sortCandidates([a, b, c], HotelSearchSort.Name))).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(
      names(sortCandidates([a, b, c], HotelSearchSort.Name, SortOrder.Desc)),
    ).toEqual(['C', 'B', 'A']);
  });

  it('does not change the list it was given', () => {
    const list = [a, b, c];
    sortCandidates(list, HotelSearchSort.Price);
    expect(names(list)).toEqual(['A', 'B', 'C']);
  });
});
