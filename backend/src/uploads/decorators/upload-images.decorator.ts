import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import {
  IMAGE_UPLOAD_OPTIONS,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGE_BYTES,
} from '../uploads.constants';

/**
 * For a route that receives several images (a post, an activity or a hotel).
 * The files arrive in the multipart field `images`; read them with
 * `@UploadedFiles()`, then pass them to UploadsService.
 *
 * A file over 5 MB is refused here with 413. Swagger shows a file picker.
 */
export function UploadImages(field = 'images') {
  return applyDecorators(
    UseInterceptors(
      FilesInterceptor(field, MAX_FILES_PER_REQUEST, IMAGE_UPLOAD_OPTIONS),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: [field],
        properties: {
          [field]: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description: `JPG or PNG images, ${MAX_IMAGE_BYTES / 1024 / 1024} MB at most each`,
          },
        },
      },
    }),
  );
}
