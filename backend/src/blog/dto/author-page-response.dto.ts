import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { PublicItineraryResponseDto } from '../../itineraries/dto/public-itinerary-response.dto';
import { PostSummaryResponseDto } from './post-summary-response.dto';

/** One page of the author's published posts (GEN-05). */
export class AuthorPostsPageResponseDto {
  @ApiProperty({
    type: [PostSummaryResponseDto],
    description: 'Newest first. `[]` when there is none (GEN-04).',
  })
  items: PostSummaryResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

/** One page of the author's public itineraries (GEN-05). */
export class AuthorItinerariesPageResponseDto {
  @ApiProperty({
    type: [PublicItineraryResponseDto],
    description:
      'Most recently updated first. `[]` when there is none (GEN-04).',
  })
  items: PublicItineraryResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

/** BLG-12: the public page of an author. */
export class AuthorPageResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({
    description: 'When the account was created, in UTC',
    example: '2026-03-02T09:15:00.000Z',
  })
  joinedAt: string;

  @ApiProperty({ type: AuthorPostsPageResponseDto })
  posts: AuthorPostsPageResponseDto;

  @ApiProperty({ type: AuthorItinerariesPageResponseDto })
  itineraries: AuthorItinerariesPageResponseDto;
}
