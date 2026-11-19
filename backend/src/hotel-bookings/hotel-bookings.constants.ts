/** HTL-18: how long a Pending Payment reservation holds its rooms. */
export const HOTEL_BOOKING_HOLD_MINUTES = 10;

/** HTL-16: children are 0 to 17 years old. */
export const CHILD_AGE_MIN = 0;
export const CHILD_AGE_MAX = 17;

/**
 * HTL-18: how many due holds one run of the expiry job handles, oldest first.
 * The job runs every minute, so a larger backlog is cleared in a few runs.
 */
export const HOTEL_BOOKING_EXPIRY_BATCH_SIZE = 100;

/** HTL-17: how many new references the confirmation tries when one is already taken. */
export const REFERENCE_ATTEMPTS = 5;

/**
 * HTL-17: while a paid reservation is confirmed, its held nights are kept this
 * much longer, so they cannot expire and be taken in between. If Stripe sends
 * the event again after a crash, the nights are still held and are booked then.
 */
export const CONFIRM_NIGHTS_GRACE_MINUTES = 30;
