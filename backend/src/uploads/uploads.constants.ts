/** GEN-08: an image is at most 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Most files multer lets through in one request. This only protects memory.
 * The real limit for each kind of owner is in IMAGE_LIMITS and is checked by
 * UploadsService, so the error can say what that limit is.
 */
export const MAX_FILES_PER_REQUEST = 10;

/**
 * multer options for the image routes. No folder is set, so multer keeps each
 * file in memory and UploadsService checks it before anything reaches the disk.
 */
export const IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_REQUEST },
};

/** Stored images are served at GET /api/uploads/<file name>. */
export const UPLOADS_URL_PREFIX = '/api/uploads';

/** GEN-08: up to 5 images per post, activity or hotel and 1 logo per airline. */
export const IMAGE_LIMITS = {
  post: { max: 5, subject: 'A post', thing: 'image' },
  activity: { max: 5, subject: 'An activity', thing: 'image' },
  hotel: { max: 5, subject: 'A hotel', thing: 'image' },
  airline: { max: 1, subject: 'An airline', thing: 'logo' },
} as const;

export type ImageOwner = keyof typeof IMAGE_LIMITS;

/** The URL a stored image is served at. */
export function imageUrl(filename: string): string {
  return `${UPLOADS_URL_PREFIX}/${filename}`;
}
