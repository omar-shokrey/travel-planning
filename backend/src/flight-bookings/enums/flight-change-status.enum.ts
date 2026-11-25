/**
 * FLT-27: the status of a flight change (`flight_booking_changes`).
 *
 * - `pending_payment`: a dearer flight; its seats are held until
 *   `holdExpiresAt` while the fare difference is paid (PAY-01).
 * - `applying`: being applied to the booking (right away for an equal or
 *   cheaper flight, after the payment for a dearer one). The change job
 *   finishes one left in this status by a crash.
 * - `completed`: the booking flies the new flight.
 * - `expired`: never applied: the hold ended, or the booking was cancelled
 *   or changed by another request first. Its held seats were given back.
 */
export enum FlightChangeStatus {
  PendingPayment = 'pending_payment',
  Applying = 'applying',
  Completed = 'completed',
  Expired = 'expired',
}
