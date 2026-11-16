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

/** A currency code as in countries.csv, for example EGP. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** A country code as in countries.csv, for example EG. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** The answer when an itinerary changed under a request that edits it by position. */
export const ITINERARY_CHANGED_MESSAGE =
  'The itinerary was changed by another request. Reload it and try again.';
