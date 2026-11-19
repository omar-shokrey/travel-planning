import type { CabinClass } from './models/cabin-class.enum';

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

/*
 * The extra-bag rule of an airline (FLT-08). The workbook only says that the
 * price is above 0 and the maximum number of extra bags is 0 or more. The
 * upper limits are ours, engineering safeguards against a typing mistake, as
 * for the cabins.
 */

/**
 * The highest price of one extra bag, in minor units (USD cents): 1,000,000
 * cents is 10,000 USD, far above any real bag fee, so only an extra zero or
 * two is refused.
 */
export const EXTRA_BAG_PRICE_MAX = 1_000_000;

/**
 * The most extra bags one passenger may buy. 0 is allowed: the airline then
 * sells no extra bag. 10 is the same ceiling as the free bags of a cabin.
 */
export const MAX_EXTRA_BAGS_MAX = 10;

/**
 * The most passengers one flight search may ask seats for (FLT-11). The
 * workbook gives no limit: 9 is ours, the usual most passengers per booking
 * on airline sites; a larger group books in parts. Passengers here are seats:
 * infants (under 2) occupy no seat and are not counted (FLT-12, FLT-19).
 */
export const FLIGHT_SEARCH_PASSENGERS_MAX = 9;

/**
 * How a flight search can be ordered (FLT-15): by the price of the cheapest
 * cabin listed, by the flight's duration (arrival minus departure) or by the
 * departure time, which is the order of FLT-11 and the default.
 */
export const FLIGHT_SEARCH_SORTS = [
  'price',
  'duration',
  'departureTime',
] as const;
export type FlightSearchSort = (typeof FLIGHT_SEARCH_SORTS)[number];

/** The direction of a sort (FLT-15); ascending is the default. */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** The 400 answer of a price range whose minimum is above its maximum (FLT-15). */
export const PRICE_RANGE_MESSAGE = 'minPrice must not be greater than maxPrice';

/** The 400 answer of a well-formed airport code that is not in the airports list (FLT-03, FLT-11). */
export const unknownAirportMessage = (
  field: 'departureAirport' | 'arrivalAirport',
  code: string,
): string => `${field} ${code} is not in the airports list`;

/** The 400 answer of identical airports (FLT-03, FLT-11). */
export const SAME_AIRPORTS_MESSAGE =
  'arrivalAirport must be different from departureAirport';

/**
 * How many times a cabin edit is tried when a booking moves the cabin's seat
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
 * for example "This flight already has an economy cabin". The class is named
 * by its API value (`premium_economy`), the value the client sent.
 */
export const duplicateCabinMessage = (cabin: CabinClass): string =>
  `This flight already has ${/^[aeiou]/.test(cabin) ? 'an' : 'a'} ${cabin} cabin`;
