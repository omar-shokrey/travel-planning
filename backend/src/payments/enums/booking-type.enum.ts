/**
 * What a payment or a refund belongs to (PAY-01, PAY-03), and the kind of
 * booking in `/api/bookings/:type/:id/...` (PAY-02).
 *
 * `flight_change` is not a booking: it is one change of a confirmed flight
 * booking (FLT-27) whose fare difference is paid or refunded. Its id is the id
 * of the change, so the unique (`bookingType`, `bookingId`) indexes of
 * `payments` and `refunds` still allow one payment and one refund per key,
 * while one booking can have many changes.
 */
export enum BookingType {
  Flight = 'flight',
  Hotel = 'hotel',
  FlightChange = 'flight_change',
}

/**
 * The types that are real bookings: the PAY-02 policy routes and the admin
 * booking list (ACC-17) accept only these, never `flight_change`.
 */
export const BOOKING_KINDS = [BookingType.Flight, BookingType.Hotel] as const;

/** A real booking's type: `flight` or `hotel`. */
export type BookingKind = (typeof BOOKING_KINDS)[number];
