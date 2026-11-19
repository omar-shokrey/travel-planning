import { PassengerType } from './enums/passenger-type.enum';
import { ageOn, countByType, passengerTypeOn } from './passenger-types';

describe('ageOn', () => {
  it('counts whole years, reached on the birthday itself', () => {
    expect(ageOn('2000-06-15', '2026-06-14')).toBe(25);
    expect(ageOn('2000-06-15', '2026-06-15')).toBe(26);
    expect(ageOn('2026-06-15', '2026-06-15')).toBe(0);
  });

  it('reaches the birthday of 29 February on 1 March in a common year', () => {
    expect(ageOn('2020-02-29', '2022-02-28')).toBe(1);
    expect(ageOn('2020-02-29', '2022-03-01')).toBe(2);
    expect(ageOn('2020-02-29', '2024-02-29')).toBe(4);
  });
});

describe('passengerTypeOn (FLT-12(b))', () => {
  const DEPARTURE = '2026-12-20';

  it.each([
    ['2014-12-20', PassengerType.Adult, 'exactly 12 on the departure date'],
    ['2014-12-21', PassengerType.Child, '12 the day after the departure'],
    ['2024-12-20', PassengerType.Child, 'exactly 2 on the departure date'],
    ['2024-12-21', PassengerType.Infant, '2 the day after the departure'],
    ['2026-12-20', PassengerType.Infant, 'born on the departure date'],
    ['1950-01-01', PassengerType.Adult, 'an older adult'],
  ])('%s is %s (%s)', (dateOfBirth, type) => {
    expect(passengerTypeOn(dateOfBirth, DEPARTURE)).toBe(type);
  });

  it('uses the departure date, not today', () => {
    // 1 year old today, 2 on a departure one year later: a child, not an infant.
    expect(passengerTypeOn('2025-03-01', '2027-03-01')).toBe(
      PassengerType.Child,
    );
  });

  it('turns 2 and 12 on 1 March for a 29 February birthday in a common year', () => {
    expect(passengerTypeOn('2024-02-29', '2026-02-28')).toBe(
      PassengerType.Infant,
    );
    expect(passengerTypeOn('2024-02-29', '2026-03-01')).toBe(
      PassengerType.Child,
    );
    expect(passengerTypeOn('2016-02-29', '2028-02-28')).toBe(
      PassengerType.Child,
    );
    expect(passengerTypeOn('2016-02-29', '2028-02-29')).toBe(
      PassengerType.Adult,
    );
  });
});

describe('countByType', () => {
  it('counts each type', () => {
    expect(
      countByType([
        PassengerType.Adult,
        PassengerType.Infant,
        PassengerType.Adult,
        PassengerType.Child,
      ]),
    ).toEqual({ adults: 2, children: 1, infants: 1 });
    expect(countByType([])).toEqual({ adults: 0, children: 0, infants: 0 });
  });
});
