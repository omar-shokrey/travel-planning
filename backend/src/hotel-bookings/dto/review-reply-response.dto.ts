import { ApiProperty } from '@nestjs/swagger';
import { REPLY_TEXT_MAX_LENGTH } from '../hotel-bookings.constants';

/** HTL-26: the hotel's reply to a review. Never the moderator's id. */
export class ReviewReplyResponseDto {
  @ApiProperty({
    maxLength: REPLY_TEXT_MAX_LENGTH,
    example: 'Thank you for staying with us. We hope to welcome you again.',
  })
  text: string;

  @ApiProperty({
    description: 'When the hotel replied (UTC)',
    example: '2027-06-22T09:15:00.000Z',
  })
  repliedAt: string;
}
