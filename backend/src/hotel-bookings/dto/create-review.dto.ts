import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
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

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * HTL-23: a rating of a completed stay, with an optional text. The hotel, the
 * reservation and the author come from the route and the login, never from
 * the body.
 */
export class CreateReviewDto {
  @ApiProperty({
    description: `A whole number from ${REVIEW_RATING_MIN} to ${REVIEW_RATING_MAX}`,
    minimum: REVIEW_RATING_MIN,
    maximum: REVIEW_RATING_MAX,
    example: 4,
  })
  @IsDefined({ message: 'rating is required' })
  @IsInt({ message: 'rating must be a whole number' })
  @Min(REVIEW_RATING_MIN, {
    message: `rating must be at least ${REVIEW_RATING_MIN}`,
  })
  @Max(REVIEW_RATING_MAX, {
    message: `rating must be at most ${REVIEW_RATING_MAX}`,
  })
  rating: number;

  @ApiPropertyOptional({
    description: `Optional, at most ${REVIEW_TEXT_MAX_LENGTH} characters. Outer spaces are removed; an empty text means no text.`,
    maxLength: REVIEW_TEXT_MAX_LENGTH,
    example: 'Quiet rooms and a friendly reception.',
  })
  @Transform(trimmed)
  // Sent means checked: `null` is refused, a missing field is skipped.
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString({ message: 'text must be a text' })
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `text must have at most ${REVIEW_TEXT_MAX_LENGTH} characters`,
  })
  text?: string;
}
