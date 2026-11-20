/**
 * BON-02: the most favourites one user can keep. The workbook gives no limit;
 * this is an engineering limit that keeps one list, and the batch reads of a
 * page, small.
 */
export const FAVOURITES_MAX_PER_USER = 200;

/** BON-02: the answer of an add past the limit. */
export const FAVOURITES_LIMIT_MESSAGE = `You can keep at most ${FAVOURITES_MAX_PER_USER} favourites. Remove one to add another`;

/** BON-02: a favourite that does not exist or belongs to someone else. */
export const FAVOURITE_NOT_FOUND_MESSAGE = 'Favourite not found';

/** BON-02: a hotel that does not exist or is deactivated (ACC-15). */
export const FAVOURITE_HOTEL_NOT_FOUND_MESSAGE = 'Hotel not found';

/**
 * BON-02: an itinerary that is not publicly visible: missing, private (even
 * the caller's own), hidden (GEN-10) or of a deactivated author (ACC-12).
 */
export const FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE = 'Itinerary not found';
