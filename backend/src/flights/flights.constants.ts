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
