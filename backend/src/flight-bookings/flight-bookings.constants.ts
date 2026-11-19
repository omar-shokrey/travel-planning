/** FLT-22: how long a Pending Payment booking holds its seats. */
export const FLIGHT_BOOKING_HOLD_MINUTES = 10;

/**
 * Seats (adults and children) in one booking. The workbook sets no maximum:
 * 9 is our limit, the usual airline limit for one booking.
 */
export const FLIGHT_BOOKING_SEATS_MAX = 9;

/** FLT-12: a booking needs at least one adult. */
export const FLIGHT_BOOKING_ADULTS_MIN = 1;

/** FLT-12: an infant occupies no seat and pays this share of the fare. */
export const INFANT_FARE_PERCENT = 10;

/** One segment now; the return flight of a round trip (FLT-12) adds a second. */
export const FLIGHT_BOOKING_SEGMENTS_MAX = 2;

/**
 * FLT-22: how many due holds one run of the expiry job handles, oldest first.
 * The job runs every minute, so a larger backlog is cleared in a few runs.
 */
export const FLIGHT_BOOKING_EXPIRY_BATCH_SIZE = 100;
