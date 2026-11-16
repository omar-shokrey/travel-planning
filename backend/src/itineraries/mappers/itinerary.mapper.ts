import { DateTime } from 'luxon';
import type { ActivityResponseDto } from '../dto/activity-response.dto';
import type { CityGroupResponseDto } from '../dto/city-group-response.dto';
import type { ItineraryDayResponseDto } from '../dto/itinerary-day-response.dto';
import type { ItineraryDetailResponseDto } from '../dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from '../dto/itinerary-response.dto';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import type { Activity } from '../models/activity.schema';
import type { ItineraryDay } from '../models/itinerary-day.schema';
import type { ItineraryDocument } from '../models/itinerary.schema';

/** Turns a stored itinerary into what the API returns. */
export function toItineraryResponse(
  itinerary: ItineraryDocument,
): ItineraryResponseDto {
  return {
    id: itinerary._id.toString(),
    ownerId: itinerary.ownerId.toString(),
    title: itinerary.title,
    countries: [...itinerary.countries],
    startDate: itinerary.startDate,
    visibility: itinerary.visibility,
    dayCount: itinerary.dayCount,
  };
}

/**
 * The calendar date of the day at `index` (0 for the first day): the start
 * date plus that many days. Both are YYYY-MM-DD and the sum is done in UTC, so
 * no time zone or clock change can shift it.
 */
export function dayDate(startDate: string, index: number): string {
  return DateTime.fromISO(startDate, { zone: 'utc' })
    .plus({ days: index })
    .toFormat('yyyy-MM-dd');
}

/** A stored day with its number and date, which are derived, never stored (ITN-05). */
export function toItineraryDayResponse(
  day: ItineraryDay,
  index: number,
  startDate: string,
): ItineraryDayResponseDto {
  return {
    id: day._id.toString(),
    dayNumber: index + 1,
    date: dayDate(startDate, index),
    cityId: day.cityId,
    ...(day.notes ? { notes: day.notes } : {}),
    activities: (day.activities ?? []).map(toActivityResponse),
  };
}

/** ITN-10: an activity with only the fields it has. */
export function toActivityResponse(activity: Activity): ActivityResponseDto {
  return {
    id: activity._id.toString(),
    name: activity.name,
    ...(activity.description ? { description: activity.description } : {}),
    ...(activity.time ? { time: activity.time } : {}),
    ...(activity.cost != null ? { cost: activity.cost } : {}),
    ...(activity.currency ? { currency: activity.currency } : {}),
  };
}

/**
 * Everything a day costs, as amounts with their currency: activity costs
 * (ITN-10, counted under Activities in ITN-14), budget entries (ITN-14) and
 * transport costs (ITN-16). An activity without a cost adds nothing.
 */
export function dayCosts(day: ItineraryDay): MoneyResponseDto[] {
  const costs: MoneyResponseDto[] = [];
  for (const activity of day.activities ?? []) {
    if (activity.cost != null && activity.currency) {
      costs.push({ amount: activity.cost, currency: activity.currency });
    }
  }
  for (const entry of day.budgetEntries ?? []) {
    costs.push({ amount: entry.amount, currency: entry.currency });
  }
  for (const transport of day.transportCosts ?? []) {
    costs.push({ amount: transport.amount, currency: transport.currency });
  }
  return costs;
}

/** Adds amounts up per currency, sorted by currency code. */
export function totalPerCurrency(
  costs: MoneyResponseDto[],
): MoneyResponseDto[] {
  const totals = new Map<string, number>();
  for (const { amount, currency } of costs) {
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ amount, currency }));
}

/**
 * ITN-09: consecutive days in the same city form one group, with its day
 * count and budget subtotal. A city visited twice with other days in between
 * gives two groups. Computed on every read, so deleting (ITN-07) or moving
 * (ITN-08) a day regroups at once.
 */
export function toCityGroups(
  days: ItineraryDay[],
  startDate: string,
): CityGroupResponseDto[] {
  const groups: {
    cityId: string;
    first: number;
    last: number;
    costs: MoneyResponseDto[];
  }[] = [];
  days.forEach((day, index) => {
    const current = groups.at(-1);
    if (current && current.cityId === day.cityId) {
      current.last = index;
      current.costs.push(...dayCosts(day));
    } else {
      groups.push({
        cityId: day.cityId,
        first: index,
        last: index,
        costs: dayCosts(day),
      });
    }
  });
  return groups.map((group) => ({
    cityId: group.cityId,
    firstDayNumber: group.first + 1,
    lastDayNumber: group.last + 1,
    startDate: dayDate(startDate, group.first),
    endDate: dayDate(startDate, group.last),
    dayCount: group.last - group.first + 1,
    budgetSubtotal: totalPerCurrency(group.costs),
  }));
}

/** An itinerary with its days in order (ITN-03) and its city groups (ITN-09). */
export function toItineraryDetailResponse(
  itinerary: ItineraryDocument,
): ItineraryDetailResponseDto {
  return {
    ...toItineraryResponse(itinerary),
    days: itinerary.days.map((day, index) =>
      toItineraryDayResponse(day, index, itinerary.startDate),
    ),
    cityGroups: toCityGroups(itinerary.days, itinerary.startDate),
  };
}
