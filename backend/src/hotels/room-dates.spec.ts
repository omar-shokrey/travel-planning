import { coversNight, findOverlap, sortRanges } from './room-dates';

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
