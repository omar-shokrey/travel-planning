import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '../models/post-status.enum';

/**
 * One row of "my posts" (BLG-03): the title, the status, the dates and the
 * like and comment counts. The body, tags and images are not part of a list
 * row; the post page (BLG-02) shows them.
 */
export class MyPostResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty({ enum: PostStatus, example: PostStatus.Draft })
  status: PostStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:00:00.000Z',
    description: 'When the post was published, in UTC. Left out for a draft.',
  })
  publishedAt?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-14T10:00:00.000Z',
    description:
      'When the post was created, in UTC. The list is ordered by it, newest first.',
  })
  createdAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:00:00.000Z',
    description: 'When the post was last changed, in UTC.',
  })
  updatedAt: string;

  @ApiProperty({
    example: 4,
    description: 'How many users like the post (BLG-06).',
  })
  likeCount: number;

  @ApiProperty({
    example: 2,
    description: 'How many comments the post has (BLG-05).',
  })
  commentCount: number;
}
