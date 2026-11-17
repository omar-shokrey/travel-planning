import {
  selectRefundPercent,
  sortCancellationTiers,
} from './cancellation-tiers';

const TIERS = [
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 1, refundPercent: 10 },
];

describe('selectRefundPercent (HTL-10, the rule of FLT-09)', () => {
  it('uses the tier with the highest threshold not exceeding the days remaining', () => {
    expect(selectRefundPercent(TIERS, 45)).toBe(100);
    expect(selectRefundPercent(TIERS, 10)).toBe(50);
    expect(selectRefundPercent(TIERS, 3)).toBe(10);
  });

  it('applies a tier on exactly its threshold day', () => {
    expect(selectRefundPercent(TIERS, 30)).toBe(100);
    expect(selectRefundPercent(TIERS, 7)).toBe(50);
    expect(selectRefundPercent(TIERS, 1)).toBe(10);
  });

  it('uses the lower tier one day short of a threshold', () => {
    expect(selectRefundPercent(TIERS, 29)).toBe(50);
    expect(selectRefundPercent(TIERS, 6)).toBe(10);
  });

  it('refunds 0% when no tier applies', () => {
    expect(selectRefundPercent(TIERS, 0)).toBe(0);
  });

  it('refunds 0% when the hotel has no tiers', () => {
    expect(selectRefundPercent([], 100)).toBe(0);
  });

  it('applies a tier with threshold 0 on the check-in day itself', () => {
    const tiers = [{ daysBefore: 0, refundPercent: 20 }];

    expect(selectRefundPercent(tiers, 0)).toBe(20);
    expect(selectRefundPercent(tiers, 5)).toBe(20);
  });

  it('does not depend on the order of the tiers', () => {
    const reversed = [...TIERS].reverse();

    expect(selectRefundPercent(reversed, 10)).toBe(50);
  });

  it('follows the tiers as written, even when a later cancellation refunds more', () => {
    const unusual = [
      { daysBefore: 10, refundPercent: 20 },
      { daysBefore: 2, refundPercent: 80 },
    ];

    expect(selectRefundPercent(unusual, 12)).toBe(20);
    expect(selectRefundPercent(unusual, 5)).toBe(80);
  });
});

describe('sortCancellationTiers', () => {
  it('orders the tiers with the highest threshold first', () => {
    expect(sortCancellationTiers(TIERS).map((t) => t.daysBefore)).toEqual([
      30, 7, 1,
    ]);
  });

  it('does not change the list it was given', () => {
    const before = TIERS.map((t) => t.daysBefore);

    sortCancellationTiers(TIERS);

    expect(TIERS.map((t) => t.daysBefore)).toEqual(before);
  });
});
