import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetConversionResponseDto } from './budget-summary-response.dto';
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

  @ApiPropertyOptional({
    type: BudgetConversionResponseDto,
    nullable: true,
    description:
      'ITN-18. Only when you open your itinerary (GET /api/itineraries/:id): your currency and the exchange rates (with their date) used for every `converted` amount. `null` when no rates were ever fetched; then every `converted` is `null`.',
  })
  conversion?: BudgetConversionResponseDto | null;
}
