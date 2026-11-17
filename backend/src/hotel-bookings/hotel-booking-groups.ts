import type { QueryFilter, SortOrder } from 'mongoose';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import type { HotelBooking } from './models/hotel-booking.schema';

/** HTL-20: the three groups of "my reservations". */
export enum HotelBookingGroup {
  Upcoming = 'upcoming',
  Past = 'past',
  Cancelled = 'cancelled',
}

/**
 * HTL-20: which reservations belong to a group, as a MongoDB filter.
 * `today` is the UTC date (`YYYY-MM-DD`), `now` the current moment.
 *
 * - Upcoming: Confirmed and the check-out date has not passed (a stay that
 *   is going on is still upcoming), or Pending Payment with a hold that has
 *   not expired, so the user can still pay for it.
 * - Past: Completed, or Confirmed with a check-out date that has passed and
 *   that the completion job (HTL-23) has not reached yet.
 * - Cancelled: Cancelled.
 *
 * An expired reservation was never paid, so it is in no group; it appears
 * only in the list without a group.
 */
export function groupFilter(
  group: HotelBookingGroup | undefined,
  today: string,
  now: Date,
): QueryFilter<HotelBooking> {
  switch (group) {
    case HotelBookingGroup.Upcoming:
      return {
        $or: [
          { status: HotelBookingStatus.Confirmed, checkOut: { $gte: today } },
          {
            status: HotelBookingStatus.PendingPayment,
            holdExpiresAt: { $gt: now },
          },
        ],
      };
    case HotelBookingGroup.Past:
      return {
        $or: [
          { status: HotelBookingStatus.Completed },
          { status: HotelBookingStatus.Confirmed, checkOut: { $lt: today } },
        ],
      };
    case HotelBookingGroup.Cancelled:
      return { status: HotelBookingStatus.Cancelled };
    default:
      return {};
  }
}

/**
 * HTL-20: the order of a group. Upcoming stays come soonest first; past and
 * cancelled ones latest first; the list without a group newest first.
 */
export function groupSort(
  group: HotelBookingGroup | undefined,
): Record<string, SortOrder> {
  switch (group) {
    case HotelBookingGroup.Upcoming:
      return { checkIn: 1, _id: 1 };
    case HotelBookingGroup.Past:
    case HotelBookingGroup.Cancelled:
      return { checkIn: -1, _id: -1 };
    default:
      return { createdAt: -1, _id: -1 };
  }
}
