/**
 * HTL-20: the groups of "My hotel reservations". The rule is in
 * `hotel-reservation-groups.ts`; FLT-25 can mirror it for flights.
 */
export enum ReservationGroup {
  Upcoming = 'upcoming',
  Past = 'past',
  Cancelled = 'cancelled',
}
