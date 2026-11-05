import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Rejects a path or query value that is not a MongoDB ObjectId, so a bad id
 * gives 400 instead of a database error. Use it on ids of our own documents,
 * not on reference-data ids such as an airport's IATA code.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) {
      throw new BadRequestException(
        `${metadata.data ?? 'id'} must be a valid id (24 hexadecimal characters)`,
      );
    }
    return value;
  }
}
