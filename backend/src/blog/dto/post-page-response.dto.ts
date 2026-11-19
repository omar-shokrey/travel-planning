import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { PostAuthorResponseDto } from './post-summary-response.dto';

/** One comment on the post page (BLG-02). */
export class PostCommentResponseDto {
  @ApiProperty({ example: '6740a1b2c3d4e5f601234567' })
  id: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author: PostAuthorResponseDto;

  @ApiProperty({ example: 'Great tips, I am going to Cairo next month!' })
  body: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-15T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Later than `createdAt` when the comment was edited',
    example: '2026-11-15T10:00:00.000Z',
  })
  updatedAt: string;
}

/** One page of the comments of a post, oldest first (GEN-05). */
export class PostCommentsPageResponseDto {
  @ApiProperty({
    type: [PostCommentResponseDto],
    description:
      'Oldest first. A comment an admin hid (GEN-10) is left out. `[]` when there is none (GEN-04).',
  })
  items: PostCommentResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

/** BLG-02: the public page of a published post. */
export class PostPageResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author: PostAuthorResponseDto;

  @ApiProperty({
    description: 'When the post was published, in UTC',
    example: '2026-11-15T10:00:00.000Z',
  })
  publishedAt: string;

  @ApiProperty({
    description: 'The whole body of the post',
    example: 'I spent three amazing days exploring Cairo. The first morning…',
  })
  body: string;

  @ApiProperty({ type: [String], example: ['cairo', 'egypt'] })
  tags: string[];

  @ApiProperty({
    type: [String],
    description:
      'The stored file names of the images, in the order they were added. Each one is served at `/api/uploads/<filename>`.',
    example: ['3f2b8c1e-5a4d-4e0b-9c1f-0a1b2c3d4e5f.jpg'],
  })
  images: string[];

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({
    description:
      'The number of visible comments, kept by the server. `comments.meta.total` is counted when the page is read: the two can differ for an instant while someone comments.',
    example: 2,
  })
  commentCount: number;

  @ApiProperty({
    type: PostCommentsPageResponseDto,
    description:
      'One page of the comments, oldest first: `commentsPage` and `commentsLimit` choose it. Further pages come from `GET /api/posts/{id}/comments`.',
  })
  comments: PostCommentsPageResponseDto;
}
