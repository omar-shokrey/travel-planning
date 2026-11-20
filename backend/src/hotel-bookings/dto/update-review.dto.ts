import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX_LENGTH,
} from '../hotel-bookings.constants';

/** Validate a field whenever it was sent: `@IsOptional()` would also let `null` through. */
const whenSent = (_: object, value: unknown): boolean => value !== undefined;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * HTL-23: an edit of the author's own review. Both fields are optional, but
 * at least one must be sent (the service answers 400 otherwise). A sent
 * field is always checked, so `null` is refused. An empty `text` removes the
 * text. Not `PartialType(CreateReviewDto)`: that adds `@IsOptional()`, which
 * lets `null` through, as `UpdateCabinDto` explains.
 */
export class UpdateReviewDto {
  @ApiPropertyOptional({
    description: `A whole number from ${REVIEW_RATING_MIN} to ${REVIEW_RATING_MAX}`,
    minimum: REVIEW_RATING_MIN,
    maximum: REVIEW_RATING_MAX,
    example: 5,
  })
  @ValidateIf(whenSent)
  @IsInt({ message: 'rating must be a whole number' })
  @Min(REVIEW_RATING_MIN, {
    message: `rating must be at least ${REVIEW_RATING_MIN}`,
  })
  @Max(REVIEW_RATING_MAX, {
    message: `rating must be at most ${REVIEW_RATING_MAX}`,
  })
  rating?: number;

  @ApiPropertyOptional({
    description: `At most ${REVIEW_TEXT_MAX_LENGTH} characters, outer spaces removed. An empty text removes the text.`,
    maxLength: REVIEW_TEXT_MAX_LENGTH,
    example: 'Even better on the second night.',
  })
  @Transform(trimmed)
  @ValidateIf(whenSent)
  @IsString({ message: 'text must be a text' })
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `text must have at most ${REVIEW_TEXT_MAX_LENGTH} characters`,
  })
  text?: string;
}
