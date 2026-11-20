import { DateTime } from 'luxon';
import { imageUrl } from '../../uploads/uploads.constants';
import type { ActivityResponseDto } from '../dto/activity-response.dto';
import type { BudgetEntryResponseDto } from '../dto/budget-entry-response.dto';
import type { CityGroupResponseDto } from '../dto/city-group-response.dto';
import type { ItineraryDayResponseDto } from '../dto/itinerary-day-response.dto';
import type { ItineraryDetailResponseDto } from '../dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from '../dto/itinerary-response.dto';
import type { LinkedBookingResponseDto } from '../dto/linked-booking-response.dto';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import type { TransportCostResponseDto } from '../dto/transport-cost-response.dto';
import {
  BudgetSummaryCategory,
  SUMMARY_CATEGORY_OF,
} from '../enums/budget-summary-category.enum';
import { LINKED_BOOKING_CATEGORY } from '../enums/linked-booking-type.enum';
import type { Activity } from '../models/activity.schema';
import type { BudgetEntry } from '../models/budget-entry.schema';
import type { ItineraryDay } from '../models/itinerary-day.schema';
import type { LinkedBooking } from '../models/linked-booking.schema';
import type { TransportCost } from '../models/transport-cost.schema';
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
    moderation: itinerary.moderation,
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
    budgetEntries: (day.budgetEntries ?? []).map(toBudgetEntryResponse),
    transportCosts: (day.transportCosts ?? []).map(toTransportCostResponse),
    linkedBookings: (day.linkedBookings ?? []).map(toLinkedBookingResponse),
  };
}

/** ITN-14: a budget entry with its id. */
export function toBudgetEntryResponse(
  entry: BudgetEntry,
): BudgetEntryResponseDto {
  return {
    id: entry._id.toString(),
    category: entry.category,
    amount: entry.amount,
    currency: entry.currency,
  };
}

/**
 * ITN-27: a booking linked to a day: the copy kept on the day, never the
 * booking's other fields (passengers, owner, payment).
 */
export function toLinkedBookingResponse(
  link: LinkedBooking,
): LinkedBookingResponseDto {
  return {
    id: link._id.toString(),
    bookingType: link.bookingType,
    bookingId: link.bookingId.toString(),
    reference: link.reference,
    amount: link.amount,
    currency: link.currency,
  };
}

/** ITN-16: a transport cost with its id. */
export function toTransportCostResponse(
  cost: TransportCost,
): TransportCostResponseDto {
  return {
    id: cost._id.toString(),
    mode: cost.mode,
    fromCityId: cost.fromCityId,
    toCityId: cost.toCityId,
    amount: cost.amount,
    currency: cost.currency,
  };
}

/**
 * ITN-10: an activity with only the optional fields it has. ITN-12: its
 * images, always as a list, each with the URL it is served at.
 */
export function toActivityResponse(activity: Activity): ActivityResponseDto {
  return {
    id: activity._id.toString(),
    name: activity.name,
    ...(activity.description ? { description: activity.description } : {}),
    ...(activity.time ? { time: activity.time } : {}),
    ...(activity.cost != null ? { cost: activity.cost } : {}),
    ...(activity.currency ? { currency: activity.currency } : {}),
    images: (activity.images ?? []).map((filename) => ({
      filename,
      url: imageUrl(filename),
    })),
  };
}

/** One cost of a day, with the line of the budget summary it counts under (ITN-14). */
export interface CostLine extends MoneyResponseDto {
  category: BudgetSummaryCategory;
}

/**
 * Everything a day costs, each with its summary line (ITN-14): activity costs
 * (ITN-10) under activities, budget entries under their own category, and
 * transport costs (ITN-16) under intercity transport, and linked bookings
 * (ITN-27) under intercity transport (flight) or accommodation (hotel). An
 * activity without a cost adds nothing. The one source for the city-group subtotals (ITN-09) and
 * the budget summary (ITN-14), so they can never disagree.
 */
export function dayCostLines(day: ItineraryDay): CostLine[] {
  const lines: CostLine[] = [];
  for (const activity of day.activities ?? []) {
    if (activity.cost != null && activity.currency) {
      lines.push({
        category: BudgetSummaryCategory.Activities,
        amount: activity.cost,
        currency: activity.currency,
      });
    }
  }
  for (const entry of day.budgetEntries ?? []) {
    lines.push({
      category: SUMMARY_CATEGORY_OF[entry.category],
      amount: entry.amount,
      currency: entry.currency,
    });
  }
  for (const transport of day.transportCosts ?? []) {
    lines.push({
      category: BudgetSummaryCategory.IntercityTransport,
      amount: transport.amount,
      currency: transport.currency,
    });
  }
  for (const link of day.linkedBookings ?? []) {
    lines.push({
      category: LINKED_BOOKING_CATEGORY[link.bookingType],
      amount: link.amount,
      currency: link.currency,
    });
  }
  return lines;
}

/** Everything a day costs, as amounts with their currency (see dayCostLines). */
export function dayCosts(day: ItineraryDay): MoneyResponseDto[] {
  return dayCostLines(day).map(({ amount, currency }) => ({
    amount,
    currency,
  }));
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
    ...(itinerary.cloneSource
      ? {
          clonedFrom: {
            itineraryId: itinerary.cloneSource.itineraryId.toString(),
            authorId: itinerary.cloneSource.authorId.toString(),
            authorName: itinerary.cloneSource.authorName,
          },
        }
      : {}),
  };
}
