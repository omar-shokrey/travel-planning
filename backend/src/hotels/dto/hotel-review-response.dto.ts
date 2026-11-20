import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DELETED_AUTHOR_NAME } from '../hotels.constants';

/** HTL-26: the hotel's reply to a review on its public page. */
export class HotelReviewReplyResponseDto {
  @ApiProperty({
    maxLength: 1000,
    example: 'Thank you for staying with us. We hope to welcome you again.',
  })
  text: string;

  @ApiProperty({
    description: 'When the hotel replied (UTC)',
    example: '2026-11-06T09:15:00.000Z',
  })
  repliedAt: string;
}

/**
 * HTL-24: one review of a hotel on its public page. Only what a guest may
 * see: never the author's account id, the reservation, the moderation flag
 * or who wrote the reply.
 */
export class HotelReviewResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  id: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  rating: number;

  @ApiPropertyOptional({
    description: 'The review text; left out when the author wrote none',
    maxLength: 1000,
    example: 'Quiet rooms and a friendly front desk.',
  })
  text?: string;

  @ApiProperty({
    description: `The author's name; "${DELETED_AUTHOR_NAME}" when the account no longer exists or was deactivated (ACC-12)`,
    example: 'Sara Ahmed',
  })
  authorName: string;

  @ApiPropertyOptional({
    type: HotelReviewReplyResponseDto,
    description:
      "The hotel moderator's reply (HTL-26); left out when there is none. Never the moderator's id",
  })
  reply?: HotelReviewReplyResponseDto;

  @ApiProperty({
    description: 'When the review was written (UTC)',
    example: '2026-11-05T11:00:00.000Z',
  })
  createdAt: string;
}
