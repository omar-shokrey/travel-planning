/** PAY-03: someone else's refund or a missing one (ACC-11). */
export const REFUND_NOT_FOUND_MESSAGE = 'Refund not found';

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
