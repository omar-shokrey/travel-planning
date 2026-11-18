/**
 * The most cancellation tiers an airline may define (FLT-09). The workbook
 * sets no limit: this is an engineering safeguard that keeps a policy small
 * enough to show and to copy into every booking.
 */
export const CANCELLATION_TIERS_MAX_COUNT = 20;

/**
 * A flight number (FLT-03): 2 to 10 uppercase letters or digits, for example
 * `MS123`. The workbook gives no format; this one is ours. The DTO trims and
 * uppercases the value first, so ` ms123 ` is the same flight number.
 */
export const FLIGHT_NUMBER_PATTERN = /^[A-Z0-9]{2,10}$/;

/** An airport IATA code (FLT-02): three uppercase letters, as in `airports.csv`. */
export const AIRPORT_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * A local date-time as the moderator types it (FLT-03): `YYYY-MM-DDTHH:mm`
 * with optional `:ss`, hours 00 to 23. No `Z` and no offset: the airport's
 * time zone says which instant it is.
 */
export const LOCAL_DATE_TIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** A calendar date without a time, `YYYY-MM-DD` (`departureDateLocal`). */
export const LOCAL_DATE_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The 409 answer for a duplicate flight number on the same departure date (FLT-03). */
export const DUPLICATE_FLIGHT_MESSAGE =
  'A flight with this number already exists for your airline on this departure date';

/*
 * The limits of a cabin (FLT-04). The workbook only says that the seat count
 * is a whole number above 0 and the price above 0. The upper limits below,
 * and the rules for the bags, are ours: engineering safeguards that keep a
 * typing mistake (an extra zero) out of the schedule.
 */

/** The most seats one cabin may have. The largest airliners seat about 850. */
export const CABIN_SEATS_MAX = 1000;

/** The highest price of one seat, in minor units (USD cents): 1,000,000 USD. */
export const CABIN_PRICE_MAX = 100_000_000;

/** The most free bags a cabin may include. 0 is allowed: some fares include no bag. */
export const CABIN_FREE_BAGS_MAX = 10;

/**
 * The highest maximum weight of one bag, in whole kg. The minimum is 1 kg even
 * when a cabin includes no free bag, because an extra bag has the same maximum
 * weight as the cabin's free allowance (FLT-08).
 */
export const CABIN_BAG_WEIGHT_MAX_KG = 100;

/**
 * How often a cabin edit is tried when a booking moves the cabin's seat
 * counters between the read and the write (FLT-04). Ours: a booking takes a
 * few milliseconds, so three tries in a row failing means a busy cabin.
 */
export const CABIN_UPDATE_ATTEMPTS = 3;

/** The answers of the cabin routes (FLT-04). */
export const FLIGHT_NOT_FOUND_MESSAGE = 'Flight not found';
export const FOREIGN_FLIGHT_MESSAGE = 'This flight belongs to another airline';
export const FLIGHT_NOT_SCHEDULED_MESSAGE =
  'Only a scheduled flight can be changed';
export const FLIGHT_CHANGED_MESSAGE =
  'The flight was changed by another request. Try again.';
export const CABIN_NOT_FOUND_MESSAGE = 'Cabin not found';
export const CABIN_CHANGED_MESSAGE =
  'The cabin was changed by another request. Try again.';
export const EMPTY_CABIN_UPDATE_MESSAGE =
  'Send at least one of totalSeats, price, freeBags or maxBagKg';

/**
 * The 409 answer when the flight already has a cabin of this class (FLT-04),
 * for example "This flight already has an economy cabin".
 */
export const duplicateCabinMessage = (cabin: string): string =>
  `This flight already has ${/^[aeiou]/.test(cabin) ? 'an' : 'a'} ${cabin} cabin`;
