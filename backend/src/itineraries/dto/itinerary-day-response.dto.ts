import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityResponseDto } from './activity-response.dto';
import { BudgetEntryResponseDto } from './budget-entry-response.dto';
import { LinkedBookingResponseDto } from './linked-booking-response.dto';
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
    description:
      'ITN-14. The budget entries of the day (food, accommodation, local_transport, activities), in the order they were added',
    type: [BudgetEntryResponseDto],
  })
  budgetEntries: BudgetEntryResponseDto[];

  @ApiProperty({
    description: 'ITN-16. Transport between cities booked on this day',
    type: [TransportCostResponseDto],
  })
  transportCosts: TransportCostResponseDto[];

  @ApiProperty({
    description:
      'ITN-27. Your booked flights and hotels linked to this day, in the order they were linked. Only the owner sees them: always empty in the public view.',
    type: [LinkedBookingResponseDto],
  })
  linkedBookings: LinkedBookingResponseDto[];
}
