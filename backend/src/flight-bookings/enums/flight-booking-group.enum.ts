/**
 * FLT-25: the three lists of a user's flight bookings.
 * - Upcoming: confirmed, or waiting for payment while the hold lasts, and a
 *   flight of it has not departed yet.
 * - Past: completed, or confirmed and every flight of it has departed.
 * - Cancelled: cancelled by the user (FLT-26) or the airline (FLT-06).
 * An expired hold was never a booking and is in none of them.
 */
export enum FlightBookingGroup {
  Upcoming = 'upcoming',
  Past = 'past',
  Cancelled = 'cancelled',
}
