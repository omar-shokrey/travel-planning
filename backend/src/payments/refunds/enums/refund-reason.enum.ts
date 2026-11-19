/**
 * PAY-03: why a booking is refunded. `user_cancellation` (FLT-26, HTL-21, at
 * the provider's tiers) and `flight_cancelled` (FLT-06, 100%) follow the data
 * model. `late_payment` is new: a payment that succeeded after the booking's
 * hold ended is refunded in full (PAY-01); the spec does not list it yet.
 */
export enum RefundReason {
  UserCancellation = 'user_cancellation',
  FlightCancelled = 'flight_cancelled',
  LatePayment = 'late_payment',
}
