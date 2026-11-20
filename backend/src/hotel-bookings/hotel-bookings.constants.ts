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

/** HTL-21: the answers of a cancellation that is refused. */
export const NOT_CANCELLABLE_MESSAGE =
  'Only a confirmed reservation can be cancelled';
export const CHECK_IN_REACHED_MESSAGE =
  'The check-in date has been reached: the reservation can no longer be cancelled';
export const REFUND_CHANGED_MESSAGE =
  'The refund changed since you viewed it. View the cancellation again and confirm the new refund';

/** HTL-23: a review's rating is a whole number from 1 to 5, its text at most 1000 characters. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_TEXT_MAX_LENGTH = 1000;

/** HTL-23: the answers of the review routes. */
export const REVIEW_NOT_COMPLETED_MESSAGE =
  'Only a completed stay can be reviewed: wait until the reservation is completed (the day after check-out)';
export const REVIEW_EXISTS_MESSAGE =
  'This reservation already has a review: edit or delete it instead';
export const REVIEW_NOT_FOUND_MESSAGE = 'Review not found';
export const REVIEW_UPDATE_EMPTY_MESSAGE = 'Send a rating or a text to change';

/**
 * HTL-26: a moderator's reply to a review. The workbook gives no limit for a
 * reply, so it has the limit of a review's text.
 */
export const REPLY_TEXT_MAX_LENGTH = REVIEW_TEXT_MAX_LENGTH;

/** HTL-26: the answer to a second reply to the same review. */
export const REVIEW_REPLY_EXISTS_MESSAGE =
  'This review already has a reply: a review gets one reply only';

/** HTL-23: how many times the hotel's rating is recomputed when it changed in between. */
export const RATING_RECOMPUTE_ATTEMPTS = 3;
