import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { IMAGE_UPLOAD_OPTIONS, MAX_IMAGE_BYTES } from '../uploads.constants';

/**
 * For a route that receives one image, such as an airline logo. The file
 * arrives in the multipart field `logo` unless another name is given; read it
 * with `@UploadedFile()`, then pass it to UploadsService.
 *
 * A file over 5 MB is refused here with 413. Swagger shows a file picker.
 */
export function UploadImage(field = 'logo') {
  return applyDecorators(
    UseInterceptors(FileInterceptor(field, IMAGE_UPLOAD_OPTIONS)),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: [field],
        properties: {
          [field]: {
            type: 'string',
            format: 'binary',
            description: `A JPG or PNG image, ${MAX_IMAGE_BYTES / 1024 / 1024} MB at most`,
          },
        },
      },
    }),
  );
}
