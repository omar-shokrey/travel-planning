import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { PostSummaryResponseDto } from './post-summary-response.dto';

export class AuthorPagePostsResponseDto {
  @ApiProperty({ type: [PostSummaryResponseDto] })
  items: PostSummaryResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

export class AuthorPageItinerariesResponseDto {
  @ApiProperty({ type: [Object] })
  items: object[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

export class AuthorPageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description: 'Author account creation date in ISO 8601 UTC format',
    example: '2026-01-15T10:30:00.000Z',
  })
  joinedAt: string;

  @ApiProperty({ type: AuthorPagePostsResponseDto })
  posts: AuthorPagePostsResponseDto;

  @ApiProperty({ type: AuthorPageItinerariesResponseDto })
  itineraries: AuthorPageItinerariesResponseDto;
}
