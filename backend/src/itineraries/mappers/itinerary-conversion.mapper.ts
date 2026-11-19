import { convertTotal } from '../../exchange-rates/conversion';
import type { ItineraryDetailResponseDto } from '../dto/itinerary-detail-response.dto';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import { conversionOf, type SummaryConversion } from './budget-summary.mapper';

/**
 * ITN-18: the itinerary as its owner opens it, with every budget amount also
 * in the owner's currency: each budget entry, each activity cost, each
 * transport cost and each city-group subtotal. Same rates, rounding and
 * `null` rules as the budget summary (`convertTotal`). The amounts as entered
 * stay as they are.
 */
export function withConvertedAmounts(
  detail: ItineraryDetailResponseDto,
  conversion: SummaryConversion,
): ItineraryDetailResponseDto {
  const { currency, rates } = conversion;
  const convert = (totals: MoneyResponseDto[]): MoneyResponseDto | null =>
    rates ? convertTotal(totals, currency, rates.rates) : null;
  const one = (amount: number, from: string) =>
    convert([{ amount, currency: from }]);

  const currencies = new Set<string>();
  const days = detail.days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => {
      if (activity.cost == null || !activity.currency) return activity;
      currencies.add(activity.currency);
      return { ...activity, converted: one(activity.cost, activity.currency) };
    }),
    budgetEntries: day.budgetEntries.map((entry) => {
      currencies.add(entry.currency);
      return { ...entry, converted: one(entry.amount, entry.currency) };
    }),
    transportCosts: day.transportCosts.map((cost) => {
      currencies.add(cost.currency);
      return { ...cost, converted: one(cost.amount, cost.currency) };
    }),
  }));
  return {
    ...detail,
    days,
    cityGroups: detail.cityGroups.map((group) => ({
      ...group,
      budgetSubtotalConverted: convert(group.budgetSubtotal),
    })),
    conversion: conversionOf(conversion, [...currencies]),
  };
}
