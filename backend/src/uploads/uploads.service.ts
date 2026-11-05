import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EnvironmentVariables } from '../config/env.validation';
import { detectImageFormat, type ImageFormat } from './image-format';
import {
  IMAGE_LIMITS,
  imageUrl,
  type ImageOwner,
  MAX_IMAGE_BYTES,
} from './uploads.constants';
import type { ImageFile, StoredImage } from './uploads.types';

const FORMATS = {
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
} as const;

/** The only names this service gives to files: a random id and an extension. */
const STORED_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

/**
 * Validates and stores the images users upload (GEN-08). Feature modules call
 * it from their controllers and keep the returned `filename` in their own
 * documents (a post, an activity, a hotel or an airline).
 */
@Injectable()
export class UploadsService {
  /** Absolute path of the folder that holds the files. */
  readonly directory: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.directory = resolve(config.get('UPLOADS_DIR', { infer: true }));
  }

  /**
   * Throws when `incoming` more images would pass the limit for this owner.
   * Call it with the number of images the owner already has, before saving.
   */
  assertWithinLimit(
    owner: ImageOwner,
    existing: number,
    incoming: number,
  ): void {
    const { max, subject, thing } = IMAGE_LIMITS[owner];
    if (existing + incoming <= max) return;

    const things = max === 1 ? thing : `${thing}s`;
    const already = existing > 0 ? ` It already has ${existing}.` : '';
    throw new BadRequestException(
      `${subject} can have at most ${max} ${things}.${already}`,
    );
  }

  /** Stores one image. See saveImages. */
  async saveImage(file: ImageFile | undefined): Promise<StoredImage> {
    const [stored] = await this.saveImages(file ? [file] : []);
    return stored;
  }

  /**
   * Checks every file first (size, then the real type from its first bytes)
   * and only then writes them, so one bad file stores nothing.
   */
  async saveImages(
    files: readonly ImageFile[] | undefined,
  ): Promise<StoredImage[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No image was uploaded');
    }
    const checked = files.map((file) => ({ file, format: this.check(file) }));

    await mkdir(this.directory, { recursive: true });
    const stored: StoredImage[] = [];
    try {
      for (const { file, format } of checked) {
        stored.push(await this.write(file, format));
      }
    } catch (error) {
      await Promise.all(
        stored.map((image) => this.deleteImage(image.filename)),
      );
      throw error;
    }
    return stored;
  }

  /**
   * Removes a stored file. It does nothing when the file is already gone, or
   * when the name is not one this service gave (so a bad value in the database
   * can never reach a file outside the uploads folder).
   */
  async deleteImage(filename: string): Promise<void> {
    if (!STORED_FILENAME.test(filename)) return;
    try {
      await unlink(join(this.directory, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private check(file: ImageFile): ImageFormat {
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException(
        `${file.originalname} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
      );
    }
    const format = detectImageFormat(file.buffer);
    if (!format) {
      throw new UnsupportedMediaTypeException(
        `${file.originalname} is not a JPG or PNG image`,
      );
    }
    return format;
  }

  private async write(
    file: ImageFile,
    format: ImageFormat,
  ): Promise<StoredImage> {
    const { extension, mimeType } = FORMATS[format];
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(join(this.directory, filename), file.buffer, {
      flag: 'wx',
    });
    return {
      filename,
      url: imageUrl(filename),
      mimeType,
      size: file.buffer.length,
    };
  }
}
