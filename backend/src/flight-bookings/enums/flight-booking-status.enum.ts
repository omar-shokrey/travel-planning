/**
 * The lifecycle of a flight booking (GEN-11), with the same values as the
 * hotel reservations: Pending Payment, then Confirmed, then Completed. The
 * only other transitions are Pending Payment to Expired (the seat hold ran
 * out, FLT-22) and Confirmed to Cancelled (FLT-26).
 */
export enum FlightBookingStatus {
  PendingPayment = 'pending_payment',
  Confirmed = 'confirmed',
  Completed = 'completed',
  Expired = 'expired',
  Cancelled = 'cancelled',
}
