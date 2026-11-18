import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { POST_TAG_MAX_LENGTH, POST_TAGS_MAX_COUNT } from '../blog.constants';

/**
 * Trims and lowercases each tag, drops empty ones and repeats (BLG-08).
 * Anything that is not a list, and any tag that is not text, is left as it
 * is, so the validators can refuse it.
 */
export function normalizeTags({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return [
    ...new Set(
      value
        .map((tag: unknown) =>
          typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
        )
        .filter((tag) => tag !== ''),
    ),
  ];
}

/**
 * The rules of the `tags` field, shared by creating a post (BLG-01) and
 * editing it (BLG-08), so both accept exactly the same tags. The field is
 * validated whenever it is sent: `null` answers 400.
 */
export function PostTags(): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeTags),
    ValidateIf((_dto, value) => value !== undefined),
    IsArray(),
    ArrayMaxSize(POST_TAGS_MAX_COUNT),
    IsString({ each: true }),
    MaxLength(POST_TAG_MAX_LENGTH, { each: true }),
  );
}
