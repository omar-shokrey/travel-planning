import { Types } from 'mongoose';
import {
  canHost,
  defaultSortOrder,
  groupNightsByRoom,
  isFreeForStay,
  nightsOfTheStay,
  passesFilters,
  roomsThatCanBeFree,
  sortResults,
  STAY_NIGHT_FIELDS,
  takesTheNight,
} from './hotel-search';
import { RoomNightState } from './models/room-night-state.enum';

const NOW = new Date('2026-12-01T10:00:00.000Z');
const stay = { from: '2026-12-20', to: '2026-12-23' };
const room = (
  maxOccupancy = 2,
  availability = [{ from: '2026-12-01', to: '2027-01-01' }],
) => ({ maxOccupancy, pricePerNight: 10000, availability });

describe('takesTheNight (HTL-11)', () => {
  it('counts blocked and booked nights', () => {
    expect(
      takesTheNight({ date: '2026-12-20', state: RoomNightState.Blocked }, NOW),
    ).toBe(true);
    expect(
      takesTheNight({ date: '2026-12-20', state: RoomNightState.Booked }, NOW),
    ).toBe(true);
  });

  it('counts a hold only until it expires (HTL-18)', () => {
    const held = (holdExpiresAt?: Date) => ({
      date: '2026-12-20',
      state: RoomNightState.Held,
      holdExpiresAt,
    });
    expect(takesTheNight(held(new Date(NOW.getTime() + 1)), NOW)).toBe(true);
    expect(takesTheNight(held(NOW), NOW)).toBe(false);
    expect(takesTheNight(held(new Date(NOW.getTime() - 1)), NOW)).toBe(false);
    expect(takesTheNight(held(), NOW)).toBe(false);
  });
});

describe('isFreeForStay (HTL-11)', () => {
  it('is free when every night is available and none is taken', () => {
    expect(isFreeForStay(room(), stay, [], NOW)).toBe(true);
  });

  it('is free across two availability ranges that touch', () => {
    const split = room(2, [
      { from: '2026-12-15', to: '2026-12-21' },
      { from: '2026-12-21', to: '2026-12-30' },
    ]);
    expect(isFreeForStay(split, stay, [], NOW)).toBe(true);
  });

  it.each([
    ['starts too late', [{ from: '2026-12-21', to: '2026-12-30' }]],
    ['ends a night early', [{ from: '2026-12-01', to: '2026-12-22' }]],
    [
      'has a gap in the middle',
      [
        { from: '2026-12-01', to: '2026-12-21' },
        { from: '2026-12-22', to: '2026-12-30' },
      ],
    ],
    ['has no range', []],
  ])('is not free when the availability %s', (_label, availability) => {
    expect(isFreeForStay(room(2, availability), stay, [], NOW)).toBe(false);
  });

  it('is free when availability ends on the check-out day (it is not a night)', () => {
    const exact = room(2, [{ from: '2026-12-20', to: '2026-12-23' }]);
    expect(isFreeForStay(exact, stay, [], NOW)).toBe(true);
  });

  it('is not free when one night is taken', () => {
    expect(
      isFreeForStay(
        room(),
        stay,
        [{ date: '2026-12-22', state: RoomNightState.Booked }],
        NOW,
      ),
    ).toBe(false);
  });

  it('is free when its only night document is an expired hold', () => {
    expect(
      isFreeForStay(
        room(),
        stay,
        [
          {
            date: '2026-12-21',
            state: RoomNightState.Held,
            holdExpiresAt: new Date(NOW.getTime() - 60_000),
          },
        ],
        NOW,
      ),
    ).toBe(true);
  });
});

describe('canHost (HTL-11)', () => {
  const rooms = (...occupancies: number[]) =>
    occupancies.map((occupancy) => room(occupancy));

  it('needs at least the number of rooms searched for', () => {
    expect(canHost(rooms(4), 2, 2)).toBe(false);
    expect(canHost(rooms(1, 1), 2, 2)).toBe(true);
    expect(canHost([], 1, 1)).toBe(false);
  });

  it('needs the largest rooms together to hold all the guests', () => {
    // One room for 5 guests: the room for 4 is not enough.
    expect(canHost(rooms(2, 4, 3), 1, 5)).toBe(false);
    expect(canHost(rooms(2, 4, 3), 1, 4)).toBe(true);
    // Two rooms: 4 + 3 = 7 is the most two rooms can hold.
    expect(canHost(rooms(2, 4, 3), 2, 7)).toBe(true);
    expect(canHost(rooms(2, 4, 3), 2, 8)).toBe(false);
  });

  it('accepts fewer guests than rooms', () => {
    expect(canHost(rooms(2, 2), 2, 1)).toBe(true);
  });
});

describe('roomsThatCanBeFree (HTL-11, HTL-15)', () => {
  it('reads only active rooms bookable on the first night', () => {
    expect(roomsThatCanBeFree(stay)).toEqual({
      active: true,
      availability: {
        $elemMatch: { from: { $lte: '2026-12-20' }, to: { $gt: '2026-12-20' } },
      },
    });
  });
});

describe('nightsOfTheStay (HTL-11, HTL-15)', () => {
  it('reads the nights of these rooms from check-in up to the day before check-out', () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];

    expect(nightsOfTheStay(ids, stay)).toEqual({
      roomId: { $in: ids },
      date: { $gte: '2026-12-20', $lt: '2026-12-23' },
    });
  });

  it('reads every field isFreeForStay needs', () => {
    expect(STAY_NIGHT_FIELDS.split(' ').sort()).toEqual([
      'date',
      'holdExpiresAt',
      'roomId',
      'state',
    ]);
  });
});

describe('groupNightsByRoom (HTL-11, HTL-15)', () => {
  const first = new Types.ObjectId();
  const second = new Types.ObjectId();
  const night = (roomId: Types.ObjectId, date: string) => ({
    roomId,
    date,
    state: RoomNightState.Booked,
  });

  it('groups the nights by room id, keeping the order they were read in', () => {
    const nights = [
      night(first, '2026-12-21'),
      night(second, '2026-12-20'),
      night(first, '2026-12-20'),
    ];

    const byRoom = groupNightsByRoom(nights);

    expect([...byRoom.keys()]).toEqual([first.toString(), second.toString()]);
    expect(byRoom.get(first.toString())).toEqual([nights[0], nights[2]]);
    expect(byRoom.get(second.toString())).toEqual([nights[1]]);
  });

  it('gives an empty map for no nights', () => {
    expect(groupNightsByRoom([]).size).toBe(0);
  });

  it('groups a year of nights of one room in one list', () => {
    const nights = Array.from({ length: 366 }, (_, day) =>
      night(first, `day-${day}`),
    );

    const byRoom = groupNightsByRoom(nights);

    expect(byRoom.get(first.toString())).toHaveLength(366);
    expect(byRoom.get(first.toString())?.[365]).toBe(nights[365]);
  });
});

/** A search result with only what the filters and the order read. */
const ranked = (
  name: string,
  lowestPricePerNight: number,
  averageRating = 0,
  ratingCount = averageRating > 0 ? 1 : 0,
) => ({ name, lowestPricePerNight, ratingCount, averageRating });

const namesOf = (results: { name: string }[]) =>
  results.map((result) => result.name);

describe('passesFilters (HTL-12)', () => {
  const hotel = ranked('Garden', 10000, 4);

  it('keeps every hotel when no filter is set, rated or not', () => {
    expect(passesFilters(hotel, {})).toBe(true);
    expect(passesFilters(ranked('New', 10000), {})).toBe(true);
  });

  it('keeps a price equal to minPrice and leaves out one cent below it', () => {
    expect(passesFilters(hotel, { minPrice: 10000 })).toBe(true);
    expect(passesFilters(hotel, { minPrice: 10001 })).toBe(false);
  });

  it('keeps a price equal to maxPrice and leaves out one cent above it', () => {
    expect(passesFilters(hotel, { maxPrice: 10000 })).toBe(true);
    expect(passesFilters(hotel, { maxPrice: 9999 })).toBe(false);
  });

  it('keeps the price when minPrice and maxPrice are both equal to it', () => {
    expect(passesFilters(hotel, { minPrice: 10000, maxPrice: 10000 })).toBe(
      true,
    );
  });

  it('accepts a minPrice of 0', () => {
    expect(passesFilters(ranked('Free', 0), { minPrice: 0 })).toBe(true);
  });

  it('reads only the cheapest free room: a hotel whose cheapest room is below the range is left out', () => {
    // lowestPricePerNight is the cheapest room free for the stay (the result
    // mapper takes the lowest price), so a dearer room inside the range does
    // not bring the hotel back.
    const cheapAndDear = ranked('Mixed', 8000);

    expect(
      passesFilters(cheapAndDear, { minPrice: 9000, maxPrice: 20000 }),
    ).toBe(false);
    expect(passesFilters(cheapAndDear, { maxPrice: 9000 })).toBe(true);
  });

  it('keeps an average rating equal to minRating and leaves out a lower one', () => {
    expect(passesFilters(ranked('A', 10000, 4), { minRating: 4 })).toBe(true);
    expect(passesFilters(ranked('B', 10000, 3.99), { minRating: 4 })).toBe(
      false,
    );
    expect(passesFilters(ranked('C', 10000, 4.5), { minRating: 4.5 })).toBe(
      true,
    );
  });

  it('leaves out a hotel with no rating yet only when minRating is set', () => {
    const unrated = ranked('New', 10000);

    expect(passesFilters(unrated, { minRating: 1 })).toBe(false);
    expect(passesFilters(unrated, { minPrice: 0, maxPrice: 20000 })).toBe(true);
  });

  it('needs both the price and the rating to pass when both are set', () => {
    const filters = { maxPrice: 10000, minRating: 4 };

    expect(passesFilters(ranked('Both', 10000, 4), filters)).toBe(true);
    expect(passesFilters(ranked('Dear', 10001, 5), filters)).toBe(false);
    expect(passesFilters(ranked('Low', 9000, 3), filters)).toBe(false);
  });
});

describe('defaultSortOrder (HTL-12)', () => {
  it.each([
    ['name', 'asc'],
    ['price', 'asc'],
    ['rating', 'desc'],
  ] as const)('sorts %s %s when no order is sent', (sortBy, order) => {
    expect(defaultSortOrder(sortBy)).toBe(order);
  });
});

describe('sortResults (HTL-12)', () => {
  // In the name order, as the hotels are read.
  const byName = [
    ranked('Alpha', 20000, 3),
    ranked('Bravo', 10000),
    ranked('Charlie', 10000, 5),
    ranked('Delta', 30000, 3),
    ranked('Echo', 5000),
  ];

  it('keeps the name order for name asc and reverses it for name desc', () => {
    expect(namesOf(sortResults(byName, 'name', 'asc'))).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ]);
    expect(namesOf(sortResults(byName, 'name', 'desc'))).toEqual([
      'Echo',
      'Delta',
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('sorts by price cheapest first, with a tie in the name order', () => {
    expect(namesOf(sortResults(byName, 'price', 'asc'))).toEqual([
      'Echo',
      'Bravo',
      'Charlie',
      'Alpha',
      'Delta',
    ]);
  });

  it('sorts by price dearest first, with a tie still in the name order', () => {
    expect(namesOf(sortResults(byName, 'price', 'desc'))).toEqual([
      'Delta',
      'Alpha',
      'Bravo',
      'Charlie',
      'Echo',
    ]);
  });

  it('sorts by rating best first, a tie in the name order, unrated hotels last', () => {
    expect(namesOf(sortResults(byName, 'rating', 'desc'))).toEqual([
      'Charlie',
      'Alpha',
      'Delta',
      'Bravo',
      'Echo',
    ]);
  });

  it('sorts by rating worst first and still puts unrated hotels last', () => {
    expect(namesOf(sortResults(byName, 'rating', 'asc'))).toEqual([
      'Alpha',
      'Delta',
      'Charlie',
      'Bravo',
      'Echo',
    ]);
  });

  it('reads a hotel with no rating count as unrated, whatever its average', () => {
    const stale = { ...ranked('Stale', 10000), averageRating: 5 };

    expect(
      namesOf(
        sortResults([stale, ranked('Rated', 10000, 1)], 'rating', 'desc'),
      ),
    ).toEqual(['Rated', 'Stale']);
  });

  it('returns a new array and leaves the input as it was', () => {
    const input = [...byName];
    const sorted = sortResults(input, 'price', 'asc');

    expect(sorted).not.toBe(input);
    expect(namesOf(input)).toEqual(namesOf(byName));
  });

  it('keeps every other field of the results', () => {
    const [first] = sortResults(
      [{ ...ranked('Garden', 100), id: 'x' }],
      'price',
      'asc',
    );

    expect(first).toEqual({ ...ranked('Garden', 100), id: 'x' });
  });
});
