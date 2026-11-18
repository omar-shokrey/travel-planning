export const HOTEL_NAME_MAX_LENGTH = 100;
export const HOTEL_ADDRESS_MAX_LENGTH = 200;
export const HOTEL_DESCRIPTION_MAX_LENGTH = 2000;
export const HOTEL_STAR_CLASS_MIN = 1;
export const HOTEL_STAR_CLASS_MAX = 5;
export const HOTEL_AMENITIES_MAX_COUNT = 30;
export const HOTEL_AMENITY_MAX_LENGTH = 50;
export const HOTEL_CITY_ID_MAX_LENGTH = 50;
export const ROOM_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** HTL-10: a hotel has at most this many cancellation tiers. */
export const HOTEL_CANCELLATION_TIERS_MAX_COUNT = 10;

/**
 * HTL-03, HTL-05: the highest price per night of a room, in minor units
 * (10,000,000.00). The workbook gives no limit; this is an engineering cap so
 * that price x nights x rooms in a reservation (HTL-16) stays an exact whole
 * number: 1e9 x 366 nights x 1000 rooms = 3.66e14, below
 * Number.MAX_SAFE_INTEGER (about 9.007e15).
 */
export const ROOM_PRICE_MAX = 1_000_000_000;

/** HTL-05: a room has at most this many availability ranges. */
export const ROOM_AVAILABILITY_RANGES_MAX_COUNT = 100;
