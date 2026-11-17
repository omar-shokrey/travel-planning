/** HTL-18: how long a Pending Payment reservation holds its rooms. */
export const HOTEL_BOOKING_HOLD_MINUTES = 10;

/** HTL-16: the most rooms one reservation can book (the same as HTL-11). */
export const HOTEL_BOOKING_MAX_ROOMS = 10;

/**
 * HTL-16: an upper bound for the adults and for the children of one room,
 * only to refuse absurd input. The room's maximum occupancy is the real limit.
 */
export const HOTEL_BOOKING_MAX_GUESTS_PER_ROOM = 40;

/** HTL-16: children are 0 to 17 years old. */
export const CHILD_AGE_MIN = 0;
export const CHILD_AGE_MAX = 17;

/** HTL-18: how many reservations one run of the hold-expiry job handles. */
export const HOTEL_BOOKING_EXPIRY_BATCH = 100;

/** HTL-23: how many confirmed stays one run of the completion job handles. */
export const HOTEL_BOOKING_COMPLETION_BATCH = 100;

/** HTL-23: a rating is a whole number from 1 to 5. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** HTL-23: the review text has at most 1000 characters. */
export const REVIEW_TEXT_MAX_LENGTH = 1000;
