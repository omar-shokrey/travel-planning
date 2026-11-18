import { ApiProperty } from '@nestjs/swagger';
import { DELETED_USER_NAME, POST_EXCERPT_LENGTH } from '../blog.constants';

/** The author shown on a post row. */
export class PostAuthorResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({
    example: 'Sara Ahmed',
    description: `"${DELETED_USER_NAME}" when the account is gone or deactivated`,
  })
  name: string;
}

/** One published post in a public list: a tag page (BLG-08) or a search (BLG-09). */
export class PostSummaryResponseDto {
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
    description: `The start of the body: its first ${POST_EXCERPT_LENGTH} characters at most, cut at a space, followed by "…" when the body is longer`,
    example: 'I spent three amazing days exploring Cairo…',
  })
  excerpt: string;

  @ApiProperty({ type: [String], example: ['cairo', 'egypt'] })
  tags: string[];

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({ example: 2 })
  commentCount: number;
}
