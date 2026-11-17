/** The two numbers of a cancellation tier, wherever it is stored (FLT-09). */
export interface CancellationTierRule {
  daysBefore: number;
  refundPercent: number;
}

/**
 * The refund, in percent, for a flight booking cancelled `daysRemaining`
 * days before departure (FLT-09): the tier with the highest `daysBefore`
 * that does not exceed the days remaining. When no tier applies, including
 * an empty policy or a negative number of days, the refund is 0%.
 *
 * It reads neither the database nor the clock. The caller (the booking
 * cancellation, FLT-26 and PAY-03) computes `daysRemaining` as the whole
 * number of days between the cancellation and the departure, and uses the
 * tiers copied into the booking when it was made, so a later policy change
 * does not change the refund of an existing booking.
 */
export function refundPercentFor(
  tiers: readonly CancellationTierRule[],
  daysRemaining: number,
): number {
  let selected: CancellationTierRule | undefined;
  for (const tier of tiers) {
    if (
      tier.daysBefore <= daysRemaining &&
      (!selected || tier.daysBefore > selected.daysBefore)
    ) {
      selected = tier;
    }
  }
  return selected?.refundPercent ?? 0;
}

/** A copy of the tiers with the highest threshold first, the order they are stored and shown in. */
export function sortTiersByDaysBefore<T extends CancellationTierRule>(
  tiers: readonly T[],
): T[] {
  return [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
}
