/** A post has at most 5 tags of at most 30 characters each (BLG-08). */
export const POST_TAGS_MAX_COUNT = 5;
export const POST_TAG_MAX_LENGTH = 30;

/** How many characters of the body a list row shows (BLG-08, BLG-09). */
export const POST_EXCERPT_LENGTH = 200;

/** The name shown for an author whose account is gone or deactivated. */
export const DELETED_USER_NAME = 'Deleted user';

/** The longest search keyword (BLG-09). The workbook sets no limit. */
export const POST_SEARCH_MAX_LENGTH = 100;

/**
 * How many matching authors a search reads at most (BLG-09). A keyword that
 * matches more author names still finds their posts by title and tag; the
 * limit keeps the `$in` list of one query bounded.
 */
export const SEARCH_AUTHORS_MAX_COUNT = 500;

/** BLG-05: a comment is non-empty and at most 500 characters. */
export const COMMENT_BODY_MAX = 500;
