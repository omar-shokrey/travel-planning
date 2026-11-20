import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { REPLY_TEXT_MAX_LENGTH } from '../hotel-bookings.constants';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * HTL-26: the hotel moderator's reply to a review. Only the text: the
 * review, the moderator and the time come from the route, the login and the
 * server, so `repliedAt` and `moderatorId` are refused like any other field.
 */
export class CreateReviewReplyDto {
  @ApiProperty({
    description: `The reply, 1 to ${REPLY_TEXT_MAX_LENGTH} characters. Outer spaces are removed, so a text of spaces only is refused.`,
    minLength: 1,
    maxLength: REPLY_TEXT_MAX_LENGTH,
    example: 'Thank you for staying with us. We hope to welcome you again.',
  })
  @Transform(trimmed)
  @IsDefined({ message: 'text is required' })
  @IsString({ message: 'text must be a text' })
  @IsNotEmpty({ message: 'text must not be empty' })
  @MaxLength(REPLY_TEXT_MAX_LENGTH, {
    message: `text must have at most ${REPLY_TEXT_MAX_LENGTH} characters`,
  })
  text: string;
}
