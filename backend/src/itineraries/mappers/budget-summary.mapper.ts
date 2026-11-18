import type {
  BudgetCategoryTotalResponseDto,
  BudgetSummaryResponseDto,
} from '../dto/budget-summary-response.dto';
import { BUDGET_SUMMARY_CATEGORIES } from '../enums/budget-summary-category.enum';
import type { ItineraryDocument } from '../models/itinerary.schema';
import {
  type CostLine,
  dayCostLines,
  dayDate,
  totalPerCurrency,
} from './itinerary.mapper';

/** The five summary lines, always all of them and in the same order. */
function byCategory(
  lines: readonly CostLine[],
): BudgetCategoryTotalResponseDto[] {
  return BUDGET_SUMMARY_CATEGORIES.map((category) => ({
    category,
    total: totalPerCurrency(lines.filter((line) => line.category === category)),
  }));
}

/**
 * ITN-14: the total budget of an itinerary, by category and by day. Built
 * from `dayCostLines`, the same source as the city-group subtotals (ITN-09),
 * and added up with `totalPerCurrency`, so the total, the days, the
 * categories and the city groups always agree. Nothing is converted (ITN-18).
 */
export function toBudgetSummaryResponse(
  itinerary: ItineraryDocument,
): BudgetSummaryResponseDto {
  const days = itinerary.days.map((day, index) => ({
    day,
    index,
    lines: dayCostLines(day),
  }));
  const all = days.flatMap(({ lines }) => lines);
  return {
    itineraryId: itinerary._id.toString(),
    total: totalPerCurrency(all),
    byCategory: byCategory(all),
    byDay: days.map(({ day, index, lines }) => ({
      dayId: day._id.toString(),
      dayNumber: index + 1,
      date: dayDate(itinerary.startDate, index),
      cityId: day.cityId,
      total: totalPerCurrency(lines),
      byCategory: byCategory(lines),
    })),
  };
}
