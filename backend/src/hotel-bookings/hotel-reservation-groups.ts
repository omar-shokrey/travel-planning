import type { SortOrder } from 'mongoose';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReservationGroup } from './enums/reservation-group.enum';

/**
 * HTL-20: which reservations "My hotel reservations" lists. A reservation that
 * waits for payment or whose hold ran out was never a stay, so it is in no
 * group: the user pays it from the reservation itself, or books again.
 */
export const LISTED_STATUSES: readonly HotelBookingStatus[] = [
  HotelBookingStatus.Confirmed,
  HotelBookingStatus.Completed,
  HotelBookingStatus.Cancelled,
];

/**
 * HTL-20: the group of one reservation on `today` (`YYYY-MM-DD`, UTC).
 *
 * - **Cancelled:** status `cancelled`.
 * - **Past:** status `completed`, or `confirmed` with a check-out before
 *   today. The completion job (GEN-11) moves a reservation to `completed`
 *   once its check-out has passed, but it runs on a schedule, so a confirmed
 *   reservation whose check-out is over is already Past.
 * - **Upcoming:** status `confirmed` with a check-out today or later, so a
 *   stay that is going on is still Upcoming until its last day.
 * - `pending_payment` and `expired` are in no group (`null`).
 *
 * The hotel's time zone is not stored, so "today" is the UTC date, as for
 * the check-in rule of HTL-16. `YYYY-MM-DD` strings compare as dates.
 */
export function groupOf(
  booking: { status: HotelBookingStatus; checkOut: string },
  today: string,
): ReservationGroup | null {
  switch (booking.status) {
    case HotelBookingStatus.Cancelled:
      return ReservationGroup.Cancelled;
    case HotelBookingStatus.Completed:
      return ReservationGroup.Past;
    case HotelBookingStatus.Confirmed:
      return booking.checkOut < today
        ? ReservationGroup.Past
        : ReservationGroup.Upcoming;
    default:
      return null;
  }
}

/** The MongoDB filter of one group, or of every listed reservation (no group). Same rule as `groupOf`. */
export function groupFilter(
  group: ReservationGroup | undefined,
  today: string,
): Record<string, unknown> {
  switch (group) {
    case ReservationGroup.Upcoming:
      return {
        status: HotelBookingStatus.Confirmed,
        checkOut: { $gte: today },
      };
    case ReservationGroup.Past:
      return {
        $or: [
          { status: HotelBookingStatus.Completed },
          { status: HotelBookingStatus.Confirmed, checkOut: { $lt: today } },
        ],
      };
    case ReservationGroup.Cancelled:
      return { status: HotelBookingStatus.Cancelled };
    default:
      return { status: { $in: [...LISTED_STATUSES] } };
  }
}

/**
 * The order of a list: Upcoming soonest check-in first; Past, Cancelled and
 * the whole list most recent first. `_id` breaks ties, so a page never
 * repeats or skips a reservation.
 */
export function groupSort(
  group: ReservationGroup | undefined,
): Record<string, SortOrder> {
  return group === ReservationGroup.Upcoming
    ? { checkIn: 1, _id: 1 }
    : group === ReservationGroup.Past
      ? { checkOut: -1, _id: -1 }
      : { checkIn: -1, _id: -1 };
}
