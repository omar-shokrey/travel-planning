import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
