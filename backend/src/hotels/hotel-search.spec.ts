import { canHost, isFreeForStay, takesTheNight } from './hotel-search';
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
