import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  HOTEL_SEARCH_GUESTS_MAX,
  HOTEL_SEARCH_ROOMS_MAX,
} from '../../hotels/hotels.constants';
import { ITINERARY_MAX_DAYS } from '../itineraries.constants';

/**
 * ITN-25: which city group of the itinerary, and for how many. The dates and
 * the city are not here: they come from the group, so the client cannot send
 * a stay that differs from the itinerary.
 */
export class ItineraryHotelsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description:
      'Which city group: the `firstDayNumber` of one of the `cityGroups` of the itinerary (ITN-09)',
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_MAX_DAYS)
  firstDayNumber: number;

  @ApiProperty({
    description: 'Number of guests',
    minimum: 1,
    maximum: HOTEL_SEARCH_GUESTS_MAX,
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_GUESTS_MAX)
  guests: number;

  @ApiPropertyOptional({
    description: 'Number of rooms',
    minimum: 1,
    maximum: HOTEL_SEARCH_ROOMS_MAX,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_ROOMS_MAX)
  rooms: number = 1;
}
