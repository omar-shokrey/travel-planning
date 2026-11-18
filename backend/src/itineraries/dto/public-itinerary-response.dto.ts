import { ApiProperty } from '@nestjs/swagger';
import { AuthorResponseDto } from './author-response.dto';
import { ItineraryDetailResponseDto } from './itinerary-detail-response.dto';
import { ItineraryResponseDto } from './itinerary-response.dto';

/** ITN-21: a public itinerary in the search results. */
export class PublicItineraryResponseDto extends ItineraryResponseDto {
  @ApiProperty({ type: AuthorResponseDto })
  author: AuthorResponseDto;
}

/** ITN-21: a public itinerary opened read-only, with its author, days, activities and budget. */
export class PublicItineraryDetailResponseDto extends ItineraryDetailResponseDto {
  @ApiProperty({ type: AuthorResponseDto })
  author: AuthorResponseDto;
}
