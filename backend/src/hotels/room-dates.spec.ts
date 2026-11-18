import {
  coversNight,
  findOverlap,
  nightCount,
  nightsOf,
  sortRanges,
  todayUtc,
  toRanges,
} from './room-dates';

const range = (from: string, to: string) => ({ from, to });

describe('sortRanges', () => {
  it('orders the ranges by their first night', () => {
    const sorted = sortRanges([
      range('2026-12-20', '2026-12-25'),
      range('2026-12-01', '2026-12-08'),
      range('2026-12-10', '2026-12-12'),
    ]);

    expect(sorted.map((r) => r.from)).toEqual([
      '2026-12-01',
      '2026-12-10',
      '2026-12-20',
    ]);
  });

  it('does not change the list it was given', () => {
    const ranges = [
      range('2026-12-20', '2026-12-25'),
      range('2026-12-01', '2026-12-08'),
    ];

    sortRanges(ranges);

    expect(ranges[0].from).toBe('2026-12-20');
  });
});

describe('findOverlap', () => {
  it('returns null for ranges that share no night', () => {
    expect(
      findOverlap([
        range('2026-12-01', '2026-12-08'),
        range('2026-12-10', '2026-12-12'),
      ]),
    ).toBeNull();
  });

  it('does not count ranges that only touch as overlapping', () => {
    expect(
      findOverlap([
        range('2026-12-01', '2026-12-08'),
        range('2026-12-08', '2026-12-12'),
      ]),
    ).toBeNull();
  });

  it('finds two ranges that share one night, in any order', () => {
    const first = range('2026-12-01', '2026-12-08');
    const second = range('2026-12-07', '2026-12-12');

    expect(findOverlap([second, first])).toEqual([first, second]);
  });

  it('finds a range that lies inside another', () => {
    const outer = range('2026-12-01', '2026-12-31');
    const inner = range('2026-12-10', '2026-12-12');

    expect(findOverlap([outer, inner])).toEqual([outer, inner]);
  });

  it('finds the same range sent twice', () => {
    expect(
      findOverlap([
        range('2026-12-01', '2026-12-08'),
        range('2026-12-01', '2026-12-08'),
      ]),
    ).not.toBeNull();
  });

  it('returns null for an empty list and for one range', () => {
    expect(findOverlap([])).toBeNull();
    expect(findOverlap([range('2026-12-01', '2026-12-08')])).toBeNull();
  });
});

describe('coversNight', () => {
  const ranges = [
    range('2026-12-01', '2026-12-08'),
    range('2026-12-20', '2026-12-22'),
  ];

  it('includes the first night of a range', () => {
    expect(coversNight(ranges, '2026-12-01')).toBe(true);
  });

  it('includes the last night, the one before the checkout boundary', () => {
    expect(coversNight(ranges, '2026-12-07')).toBe(true);
  });

  it('does not include the checkout boundary itself', () => {
    expect(coversNight(ranges, '2026-12-08')).toBe(false);
  });

  it('does not include a night between two ranges', () => {
    expect(coversNight(ranges, '2026-12-15')).toBe(false);
  });

  it('finds a night in a later range', () => {
    expect(coversNight(ranges, '2026-12-21')).toBe(true);
  });

  it('covers nothing when there are no ranges', () => {
    expect(coversNight([], '2026-12-01')).toBe(false);
  });

  it('works across a month and a year boundary', () => {
    const newYear = [range('2026-12-30', '2027-01-02')];

    expect(coversNight(newYear, '2026-12-31')).toBe(true);
    expect(coversNight(newYear, '2027-01-01')).toBe(true);
    expect(coversNight(newYear, '2027-01-02')).toBe(false);
  });
});

describe('nightsOf', () => {
  it('lists every night from the first one to the day before the boundary', () => {
    expect(nightsOf(range('2026-12-30', '2027-01-02'))).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('handles the end of February in a leap year and in a normal year', () => {
    expect(nightsOf(range('2028-02-28', '2028-03-01'))).toEqual([
      '2028-02-28',
      '2028-02-29',
    ]);
    expect(nightsOf(range('2027-02-28', '2027-03-01'))).toEqual(['2027-02-28']);
  });

  it('returns no night for an empty range', () => {
    expect(nightsOf(range('2026-12-01', '2026-12-01'))).toEqual([]);
  });
});

describe('nightCount', () => {
  it('counts the nights of a range across a month boundary', () => {
    expect(nightCount(range('2026-11-28', '2026-12-03'))).toBe(5);
  });

  it('counts a whole leap year as 366 nights', () => {
    expect(nightCount(range('2028-01-01', '2029-01-01'))).toBe(366);
  });

  it('counts 0 for an empty or reversed range', () => {
    expect(nightCount(range('2026-12-01', '2026-12-01'))).toBe(0);
    expect(nightCount(range('2026-12-05', '2026-12-01'))).toBe(0);
  });
});

describe('toRanges', () => {
  it('joins consecutive nights into one range', () => {
    expect(toRanges(['2026-12-01', '2026-12-02', '2026-12-03'])).toEqual([
      range('2026-12-01', '2026-12-04'),
    ]);
  });

  it('starts a new range after a gap, whatever order the nights are in', () => {
    expect(toRanges(['2026-12-10', '2026-12-01', '2026-12-02'])).toEqual([
      range('2026-12-01', '2026-12-03'),
      range('2026-12-10', '2026-12-11'),
    ]);
  });

  it('joins across a year boundary and ignores duplicates', () => {
    expect(toRanges(['2026-12-31', '2027-01-01', '2026-12-31'])).toEqual([
      range('2026-12-31', '2027-01-02'),
    ]);
  });

  it('returns no range for no night', () => {
    expect(toRanges([])).toEqual([]);
  });

  it('is the reverse of nightsOf', () => {
    const original = range('2026-12-20', '2027-01-05');

    expect(toRanges(nightsOf(original))).toEqual([original]);
  });
});

describe('todayUtc', () => {
  it('returns a YYYY-MM-DD date', () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
