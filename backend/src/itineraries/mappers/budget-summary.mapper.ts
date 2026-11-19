import { convertTotal, type Rates } from '../../exchange-rates/conversion';
import type {
  BudgetCategoryTotalResponseDto,
  BudgetConversionResponseDto,
  BudgetSummaryResponseDto,
} from '../dto/budget-summary-response.dto';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import { BUDGET_SUMMARY_CATEGORIES } from '../enums/budget-summary-category.enum';
import type { ItineraryDocument } from '../models/itinerary.schema';
import {
  type CostLine,
  dayCostLines,
  dayDate,
  totalPerCurrency,
} from './itinerary.mapper';

/** ITN-18: the currency to show the summary in, and the rates to use. */
export interface SummaryConversion {
  /** The user's preferred currency, or USD. */
  currency: string;
  /** The rates in use, or `null` when none were ever fetched. */
  rates: {
    rateDate: string;
    fetchedAt: Date;
    rates: Rates;
  } | null;
}

/** Turns per-currency totals into one total in the user's currency. */
type Convert = (totals: MoneyResponseDto[]) => MoneyResponseDto | null;

/** The five summary lines, always all of them and in the same order. */
function byCategory(
  lines: readonly CostLine[],
  convert: Convert,
): BudgetCategoryTotalResponseDto[] {
  return BUDGET_SUMMARY_CATEGORIES.map((category) => {
    const total = totalPerCurrency(
      lines.filter((line) => line.category === category),
    );
    return { category, total, converted: convert(total) };
  });
}

/** ITN-18: which rates were used, and the currencies that have none. */
function conversionOf(
  conversion: SummaryConversion,
  lines: readonly CostLine[],
): BudgetConversionResponseDto | null {
  const { currency, rates } = conversion;
  if (!rates) return null;
  const used = new Set([currency, ...lines.map((line) => line.currency)]);
  return {
    currency,
    rateDate: rates.rateDate,
    fetchedAt: rates.fetchedAt.toISOString(),
    missingCurrencies: [...used]
      .filter((code) => !(rates.rates[code] > 0))
      .sort(),
  };
}

/**
 * ITN-14: the total budget of an itinerary, by category and by day. Built
 * from `dayCostLines`, the same source as the city-group subtotals (ITN-09),
 * and added up with `totalPerCurrency`, so the total, the days, the
 * categories and the city groups always agree.
 *
 * ITN-18: every total also gets `converted`, the same money in the user's
 * currency, from `convertTotal`. The per-currency totals stay as they are.
 */
export function toBudgetSummaryResponse(
  itinerary: ItineraryDocument,
  conversion: SummaryConversion,
): BudgetSummaryResponseDto {
  const { currency, rates } = conversion;
  const convert: Convert = (totals) =>
    rates ? convertTotal(totals, currency, rates.rates) : null;
  const days = itinerary.days.map((day, index) => ({
    day,
    index,
    lines: dayCostLines(day),
  }));
  const all = days.flatMap(({ lines }) => lines);
  const total = totalPerCurrency(all);
  return {
    itineraryId: itinerary._id.toString(),
    total,
    converted: convert(total),
    conversion: conversionOf(conversion, all),
    byCategory: byCategory(all, convert),
    byDay: days.map(({ day, index, lines }) => {
      const dayTotal = totalPerCurrency(lines);
      return {
        dayId: day._id.toString(),
        dayNumber: index + 1,
        date: dayDate(itinerary.startDate, index),
        cityId: day.cityId,
        total: dayTotal,
        converted: convert(dayTotal),
        byCategory: byCategory(lines, convert),
      };
    }),
  };
}
