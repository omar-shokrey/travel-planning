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

/** HTL-06: one request can block at most this many nights of a room. */
export const ROOM_BLOCK_MAX_NIGHTS = 366;

/** HTL-08 and HTL-15: a date range in a query spans at most this many nights. */
export const ROOM_QUERY_MAX_NIGHTS = 366;

/**
 * HTL-11: the most rooms one search may ask for. An engineering limit, not a
 * workbook rule: it keeps the occupancy check small.
 */
export const HOTEL_SEARCH_ROOMS_MAX = 20;

/** HTL-11: the most guests one search may ask for (engineering limit). */
export const HOTEL_SEARCH_GUESTS_MAX = 100;

/**
 * HTL-12: the orders of hotel search. `name` is the order of HTL-11 and the
 * default; `price` is the hotel's lowest price per night for the stay;
 * `rating` is its average rating.
 */
export const HOTEL_SEARCH_SORTS = ['name', 'price', 'rating'] as const;
export type HotelSearchSort = (typeof HOTEL_SEARCH_SORTS)[number];

/** HTL-12: the direction of `sortBy` (the same values as the flight search). */
export const HOTEL_SEARCH_SORT_ORDERS = ['asc', 'desc'] as const;
export type HotelSearchSortOrder = (typeof HOTEL_SEARCH_SORT_ORDERS)[number];

/**
 * HTL-12: a hotel's average rating runs from 1 to 5 (HTL-23). Must match
 * `REVIEW_RATING_MIN` and `REVIEW_RATING_MAX` in hotel-bookings.constants.ts;
 * it is a copy because this module must not import hotel-bookings.
 */
export const HOTEL_RATING_MIN = 1;
export const HOTEL_RATING_MAX = 5;

/** HTL-12: the answer to a price range whose minimum is above its maximum. */
export const HOTEL_PRICE_RANGE_MESSAGE =
  'minPrice must not be greater than maxPrice';

/**
 * The reservations' collection, as the data model names it. The hotels module
 * reads it only through `HotelBookingLookup`, because the hotel-bookings
 * module imports this one and not the other way round.
 */
export const HOTEL_BOOKINGS_COLLECTION = 'hotel_bookings';

/**
 * HTL-24: the reviews' collection, as the data model names it, and the
 * `moderation` value of a review that is shown. The hotel-bookings module
 * owns reviews (HTL-23) and imports this module, so this one reads them only
 * through `HotelReviewLookup`. A spec checks both against the `Review` schema
 * and `ReviewModeration.Visible`.
 */
export const REVIEWS_COLLECTION = 'reviews';
export const VISIBLE_REVIEW_MODERATION = 'visible';

/**
 * HTL-24, ACC-12: the author shown for a review whose account is gone or
 * deactivated. The same text as `DELETED_USER_NAME` of the blog module.
 */
export const DELETED_AUTHOR_NAME = 'Deleted user';
