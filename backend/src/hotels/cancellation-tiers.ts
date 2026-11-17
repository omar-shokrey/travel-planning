/** The two numbers of a cancellation tier, wherever it is stored. */
export interface CancellationTierRule {
  daysBefore: number;
  refundPercent: number;
}

/**
 * The refund percentage for a cancellation `daysRemaining` days before
 * check-in (HTL-10, the same rule as FLT-09): the tier with the highest
 * threshold that does not exceed the days remaining. If no tier applies, the
 * refund is 0%.
 */
export function selectRefundPercent(
  tiers: readonly CancellationTierRule[],
  daysRemaining: number,
): number {
  let selected: CancellationTierRule | undefined;

  for (const tier of tiers) {
    const applies = tier.daysBefore <= daysRemaining;
    if (applies && (!selected || tier.daysBefore > selected.daysBefore)) {
      selected = tier;
    }
  }

  return selected?.refundPercent ?? 0;
}

/** Tiers ordered for display and storage: the highest threshold first. */
export function sortCancellationTiers<T extends CancellationTierRule>(
  tiers: readonly T[],
): T[] {
  return [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
}
