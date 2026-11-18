import { ApiProperty } from '@nestjs/swagger';
import { CommentModeration } from '../models/comment-moderation.enum';

/** A comment as the API returns it (BLG-05). */
export class CommentResponseDto {
  @ApiProperty({ example: '6740a1b2c3d4e5f601234567' })
  id: string;

  @ApiProperty({
    description: 'The post the comment belongs to',
    example: '6740a1b2c3d4e5f601234560',
  })
  postId: string;

  @ApiProperty({
    description: 'The user who wrote the comment',
    example: '6740a1b2c3d4e5f601234561',
  })
  authorId: string;

  @ApiProperty({ example: 'Great tips, I am going to Cairo next month!' })
  body: string;

  @ApiProperty({
    enum: CommentModeration,
    enumName: 'CommentModeration',
    description:
      'GEN-10: `hidden` when an admin hid the comment. A hidden comment is left out of the comment list; only its author still gets it, when editing it (BLG-07).',
    example: CommentModeration.Visible,
  })
  moderation: CommentModeration;

  @ApiProperty({ format: 'date-time', example: '2026-11-15T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Later than `createdAt` when the comment was edited',
    example: '2026-11-15T10:00:00.000Z',
  })
  updatedAt: string;
}
