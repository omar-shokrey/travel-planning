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

/** HTL-05: a room has at most this many availability ranges. */
export const ROOM_AVAILABILITY_RANGES_MAX_COUNT = 100;

/** HTL-06: one request can block at most this many nights of a room. */
export const ROOM_BLOCK_MAX_NIGHTS = 366;

/** HTL-08 and HTL-15: a date range in a query spans at most this many nights. */
export const ROOM_QUERY_MAX_NIGHTS = 366;

/** HTL-11: the most guests and rooms one hotel search can ask for. */
export const HOTEL_SEARCH_MAX_GUESTS = 40;
export const HOTEL_SEARCH_MAX_ROOMS = 10;
