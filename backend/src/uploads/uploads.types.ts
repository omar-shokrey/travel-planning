/** The part of a multer file (Express.Multer.File) that UploadsService needs. */
export interface ImageFile {
  originalname: string;
  buffer: Buffer;
}

/** What UploadsService returns for a stored image. Keep `filename` with the owner. */
export interface StoredImage {
  /** Random name on disk: always `<uuid>.jpg` or `<uuid>.png`. */
  filename: string;
  /** Where the image is served, for example /api/uploads/<filename>. */
  url: string;
  mimeType: 'image/jpeg' | 'image/png';
  size: number;
}
