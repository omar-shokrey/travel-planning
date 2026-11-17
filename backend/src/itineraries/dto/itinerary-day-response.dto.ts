import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityResponseDto } from './activity-response.dto';
import { TransportCostResponseDto } from './transport-cost-response.dto';

/** One day of an itinerary as the API returns it. */
export class ItineraryDayResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0d0d0' })
  id: string;

  @ApiProperty({
    description: 'Position in the itinerary, starting at 1',
    example: 1,
  })
  dayNumber: number;

  @ApiProperty({
    description: 'The start date plus the days before this one',
    example: '2026-12-20',
  })
  date: string;

  @ApiProperty({ description: 'City id from the city list', example: 'cairo' })
  cityId: string;

  @ApiPropertyOptional({ example: 'Arrive in the evening' })
  notes?: string;

  @ApiProperty({
    description:
      'ITN-10. The activities of the day, in the order they were added',
    type: [ActivityResponseDto],
  })
  activities: ActivityResponseDto[];

  @ApiProperty({
    description: 'ITN-16. Transport between cities booked on this day',
    type: [TransportCostResponseDto],
  })
  transportCosts: TransportCostResponseDto[];
}
