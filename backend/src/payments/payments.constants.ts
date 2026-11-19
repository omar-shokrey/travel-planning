/** The answers of the policy routes (PAY-02). A missing booking is "Booking not found" (the booking modules). */
export const NOT_WAITING_FOR_PAYMENT_MESSAGE =
  'This booking is not waiting for payment';
export const HOLD_EXPIRED_MESSAGE =
  'The hold has expired. Start the booking again';
export const POLICIES_NOT_ACCEPTED_MESSAGE =
  "Accept the provider's policies before paying";
export const POLICIES_MUST_BE_ACCEPTED_MESSAGE =
  'You must accept the policies to continue';
export const BOOKING_CHANGED_MESSAGE =
  'The booking was changed by another request. Try again.';

/**
 * Both booking statuses use the GEN-11 values, so "waiting for payment" is
 * the same text for a flight booking and a hotel reservation.
 */
export const PENDING_PAYMENT = 'pending_payment';
