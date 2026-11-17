import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX_LENGTH,
} from '../hotel-bookings.constants';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * HTL-23: what the guest sends to review a completed stay. The hotel, the
 * author and the reservation come from the route and the login.
 */
export class CreateReviewDto {
  @ApiProperty({
    description: `Rating, a whole number from ${REVIEW_RATING_MIN} to ${REVIEW_RATING_MAX}`,
    example: 5,
    minimum: REVIEW_RATING_MIN,
    maximum: REVIEW_RATING_MAX,
  })
  @IsInt({ message: 'rating must be a whole number' })
  @Min(REVIEW_RATING_MIN)
  @Max(REVIEW_RATING_MAX)
  rating: number;

  @ApiPropertyOptional({
    description: `Optional review text, at most ${REVIEW_TEXT_MAX_LENGTH} characters. Leading and trailing spaces are removed; an empty text means no text.`,
    example: 'Quiet rooms and a great breakfast.',
    maxLength: REVIEW_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'text must be text' })
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `text must have at most ${REVIEW_TEXT_MAX_LENGTH} characters`,
  })
  text?: string;
}
