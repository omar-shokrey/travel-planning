import {
  refundPercentFor,
  sortTiersByDaysBefore,
  type CancellationTierRule,
} from './cancellation-policy';

/** 30 or more days: 100%. 7 to 29: 50%. 1 to 6: 25%. Less than a day: nothing. */
const tiers: CancellationTierRule[] = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 25 },
];

describe('refundPercentFor (FLT-09)', () => {
  it.each([
    ['exactly on the highest threshold', 30, 100],
    ['exactly on a middle threshold', 7, 50],
    ['exactly on the lowest threshold', 1, 25],
    ['between two thresholds', 12, 50],
    ['above the largest threshold', 400, 100],
    ['just under a threshold', 29, 50],
    ['below the smallest threshold', 0, 0],
  ])('uses the right tier %s', (_label, daysRemaining, expected) => {
    expect(refundPercentFor(tiers, daysRemaining)).toBe(expected);
  });

  it('does not depend on the order of the tiers', () => {
    const unsorted = [tiers[2], tiers[0], tiers[1]];

    expect(refundPercentFor(unsorted, 12)).toBe(50);
    expect(refundPercentFor(unsorted, 31)).toBe(100);
    expect(refundPercentFor(unsorted, 3)).toBe(25);
  });

  it('applies a tier of 0 days on the day of departure', () => {
    const withSameDay = [
      ...tiers.slice(0, 2),
      { daysBefore: 0, refundPercent: 10 },
    ];

    expect(refundPercentFor(withSameDay, 0)).toBe(10);
  });

  it('refunds nothing with an empty policy', () => {
    expect(refundPercentFor([], 0)).toBe(0);
    expect(refundPercentFor([], 365)).toBe(0);
  });

  it('refunds nothing for a negative number of days (after departure)', () => {
    const withSameDay = [{ daysBefore: 0, refundPercent: 100 }];

    expect(refundPercentFor(withSameDay, -1)).toBe(0);
  });

  it('works with one tier', () => {
    const one = [{ daysBefore: 14, refundPercent: 80 }];

    expect(refundPercentFor(one, 14)).toBe(80);
    expect(refundPercentFor(one, 13)).toBe(0);
  });

  it('returns 100% and 0% tiers as they are', () => {
    const extremes = [
      { daysBefore: 10, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 0 },
    ];

    expect(refundPercentFor(extremes, 10)).toBe(100);
    expect(refundPercentFor(extremes, 5)).toBe(0);
  });
});

describe('sortTiersByDaysBefore', () => {
  it('puts the highest threshold first and leaves the input as it was', () => {
    const input = [tiers[2], tiers[0], tiers[1]];

    expect(sortTiersByDaysBefore(input)).toEqual(tiers);
    expect(input).toEqual([tiers[2], tiers[0], tiers[1]]);
  });
});
