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

/** PAY-01: the answers of the payment routes. */
export const PAYMENT_NOT_FOUND_MESSAGE = 'Payment not found';
export const ALREADY_PAID_MESSAGE = 'This booking is already paid';
export const PAYMENT_FAILED_MESSAGE =
  'The last payment attempt failed. Retry the payment instead of starting a new one';
export const PAYMENT_CANCELLED_MESSAGE =
  'The payment was cancelled because the hold ended. Start the booking again';
export const PAYMENT_UNAVAILABLE_MESSAGE =
  'The payment service is unavailable. Try again';
export const PAYMENTS_NOT_CONFIGURED_MESSAGE = 'Payments are not configured';
export const INVALID_SIGNATURE_MESSAGE = 'Invalid Stripe signature';
/** The webhook's answer while no booking module confirms bookings yet, so Stripe retries. */
export const BOOKING_CONFIRMATION_UNAVAILABLE_MESSAGE =
  'Bookings of this type cannot be confirmed yet. Send the event again later';

/** How long a processed webhook event id is remembered. */
export const STRIPE_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** At most this many payments are cancelled per run of the expiry job. */
export const PAYMENT_EXPIRY_BATCH_SIZE = 100;
