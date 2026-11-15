import { DateTime } from 'luxon';
import type { ItineraryDayResponseDto } from '../dto/itinerary-day-response.dto';
import type { ItineraryDetailResponseDto } from '../dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from '../dto/itinerary-response.dto';
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
  };
}

/** An itinerary with its days in order (ITN-03). */
export function toItineraryDetailResponse(
  itinerary: ItineraryDocument,
): ItineraryDetailResponseDto {
  return {
    ...toItineraryResponse(itinerary),
    days: itinerary.days.map((day, index) =>
      toItineraryDayResponse(day, index, itinerary.startDate),
    ),
  };
}
