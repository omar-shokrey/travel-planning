import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CityGroupResponseDto } from './city-group-response.dto';
import { CloneSourceResponseDto } from './clone-source-response.dto';
import { ItineraryDayResponseDto } from './itinerary-day-response.dto';
import { ItineraryResponseDto } from './itinerary-response.dto';

/** ITN-03: an itinerary with its days, in order, and its city groups (ITN-09). */
export class ItineraryDetailResponseDto extends ItineraryResponseDto {
  // Declared again so the example agrees with the one day in the example below.
  @ApiProperty({ description: 'Number of days in the itinerary', example: 1 })
  declare dayCount: number;

  @ApiProperty({ type: [ItineraryDayResponseDto] })
  days: ItineraryDayResponseDto[];

  @ApiProperty({
    description:
      'ITN-09. Consecutive days in the same city, in day order. Computed from the days, never stored.',
    type: [CityGroupResponseDto],
  })
  cityGroups: CityGroupResponseDto[];

  @ApiPropertyOptional({
    description: 'ITN-21. Present only on a clone: the original and its author',
    type: CloneSourceResponseDto,
  })
  clonedFrom?: CloneSourceResponseDto;
}
