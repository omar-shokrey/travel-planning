import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '../models/post-status.enum';

export class PostResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:00:00.000Z',
    description: 'When the post was published, in UTC. Left out for a draft.',
  })
  publishedAt?: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ type: [String] })
  images: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6741c0ffee0ddba11ad0b0b0',
    description:
      'BLG-13: the id of the itinerary attached to the post, or `null` when none is',
  })
  itineraryId: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:00:00.000Z',
  })
  updatedAt: string;
}
