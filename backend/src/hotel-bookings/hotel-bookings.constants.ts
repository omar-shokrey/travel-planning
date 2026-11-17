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
