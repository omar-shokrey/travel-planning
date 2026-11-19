/**
 * The lifecycle of a hotel reservation (GEN-11): Pending Payment, then
 * Confirmed, then Completed. The only other transitions are Pending Payment
 * to Expired (the hold ran out, HTL-18) and Confirmed to Cancelled (HTL-21).
 */
export enum HotelBookingStatus {
  PendingPayment = 'pending_payment',
  Confirmed = 'confirmed',
  Completed = 'completed',
  Expired = 'expired',
  Cancelled = 'cancelled',
}
