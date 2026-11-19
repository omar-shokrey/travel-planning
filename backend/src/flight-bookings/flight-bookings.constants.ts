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

/**
 * FLT-19: most passengers in one booking. At most 9 seats (adults and
 * children) and no more infants than adults give at most 9 adults and 9
 * infants, so 18. Our limit, derived from the two rules above.
 */
export const FLIGHT_BOOKING_PASSENGERS_MAX = FLIGHT_BOOKING_SEATS_MAX * 2;

/**
 * FLT-19: a passenger's full name, 2 to 100 characters after trimming. The
 * workbook gives no length: these are our limits.
 */
export const PASSENGER_FULL_NAME_MIN_LENGTH = 2;
export const PASSENGER_FULL_NAME_MAX_LENGTH = 100;

/**
 * FLT-19: a passport or ID number is 5 to 20 letters and digits, stored in
 * upper case. The workbook gives no format: this is our rule.
 */
export const PASSPORT_NUMBER_MIN_LENGTH = 5;
export const PASSPORT_NUMBER_MAX_LENGTH = 20;
export const PASSPORT_NUMBER_PATTERN = /^[A-Z0-9]+$/;

/** FLT-19: a date of birth at most this many years back. Our limit. */
export const PASSENGER_MAX_AGE_YEARS = 120;

/** FLT-12(b): adult 12 or older, child 2 to 11, infant younger than 2, on the departure date. */
export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;

/** FLT-19: the answer when the flight's date or bag rule changed between the read and the hold. */
export const FLIGHT_CHANGED_MESSAGE =
  'The flight changed while booking. Try again.';
