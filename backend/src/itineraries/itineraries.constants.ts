/** ITN-01: an itinerary title has at most 100 characters. */
export const ITINERARY_TITLE_MAX = 100;

/** ITN-05: an itinerary has at most 60 days. */
export const ITINERARY_MAX_DAYS = 60;

/** A calendar date without a time, for example 2026-12-20. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A time of day in 24-hour form, for example 09:30. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ITN-10: limits for an activity, so one itinerary document stays small. */
export const ACTIVITY_NAME_MAX = 100;
export const ACTIVITY_DESCRIPTION_MAX = 1000;

/** ITN-16: the longest transport mode, such as "train" or "night bus". */
export const TRANSPORT_MODE_MAX = 50;

/**
 * The largest amount of one budget entry, activity cost or transport cost, in
 * minor units: 10,000,000,000 (100,000,000.00 in a 2-decimal currency). An
 * engineering limit, not a workbook rule: it keeps every total a safe integer
 * (see "Money limits" in the README for the arithmetic).
 */
export const MONEY_AMOUNT_MAX = 10_000_000_000;

/**
 * ITN-14: the most budget entries one day can have, so one itinerary document
 * stays small. An engineering limit, not a workbook rule.
 */
export const BUDGET_ENTRIES_PER_DAY_MAX = 50;

/**
 * ITN-27: the most bookings one day can have linked, so one itinerary
 * document stays small. An engineering limit, not a workbook rule.
 */
export const LINKED_BOOKINGS_PER_DAY_MAX = 10;

/** ITN-27: the answers of linking a booking to a day. */
export const BOOKING_NOT_LINKABLE_MESSAGE =
  'Only a confirmed or completed booking can be linked';
export const BOOKING_ALREADY_LINKED_MESSAGE =
  'This booking is already linked to this itinerary';
export const LINKED_BOOKINGS_PER_DAY_MESSAGE = `A day has at most ${LINKED_BOOKINGS_PER_DAY_MAX} linked bookings`;

/** A currency code as in countries.csv, for example EGP. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** A country code as in countries.csv, for example EG. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** The answer when an itinerary changed under a request that edits it by position. */
export const ITINERARY_CHANGED_MESSAGE =
  'The itinerary was changed by another request. Reload it and try again.';

/** ITN-26: the answers of the flights of an itinerary. */
export const NO_DAYS_FOR_FLIGHTS_MESSAGE =
  'This itinerary has no days yet, so it has no first city: add a day to search flights';
export const NO_AIRPORT_IN_FIRST_CITY_MESSAGE =
  "The city of the itinerary's first day has no airport in the airports list";
export const unknownOriginMessage = (code: string): string =>
  `originAirport ${code} is not in the airports list`;
export const ORIGIN_IN_FIRST_CITY_MESSAGE =
  "originAirport is in the city of the itinerary's first day: choose an airport you fly from";
export const RETURN_DATE_ONE_WAY_MESSAGE =
  'returnDate is only for a round trip (tripType round_trip)';
