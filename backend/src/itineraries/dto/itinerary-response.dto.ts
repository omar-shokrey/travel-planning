import { ApiProperty } from '@nestjs/swagger';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';

/** An itinerary as the API returns it. */
export class ItineraryResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0c0de' })
  id: string;

  @ApiProperty({ example: '6741c0ffee0ddba11ad0beef' })
  ownerId: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({
    enum: ItineraryVisibility,
    example: ItineraryVisibility.Private,
  })
  visibility: ItineraryVisibility;

  @ApiProperty({ description: 'Number of days in the itinerary', example: 0 })
  dayCount: number;
}
