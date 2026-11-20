/** PAY-03: someone else's refund or a missing one (ACC-11). */
export const REFUND_NOT_FOUND_MESSAGE = 'Refund not found';

/** FLT-27: asking to refund more than is left of a payment. */
export const REFUND_EXCEEDS_PAYMENT_MESSAGE =
  'The refund is larger than what is left of the payment';

/** FLT-27: too many refunds of the same payment at the same moment. */
export const REFUND_BUSY_MESSAGE =
  'The payment is being refunded by another request. Try again.';

/**
 * How many times a refund claims its payment before it gives up (409). A
 * claim is lost only to another refund of the same payment at that moment.
 */
export const REFUND_CLAIM_ATTEMPTS = 5;

/** At most this many refunds are sent again per run of the recovery job. */
export const REFUND_RECOVERY_BATCH_SIZE = 50;

/** A refund younger than this is still being sent by its own request. */
export const REFUND_RECOVERY_MIN_AGE_MS = 60 * 1000;

/**
 * Stripe keeps an idempotency key for 24 hours. Older than this, a refund is
 * not sent again automatically (the team checks it), so a retry can never
 * create a second refund at Stripe.
 */
export const REFUND_RECOVERY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
