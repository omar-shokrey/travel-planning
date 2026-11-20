import { ApiProperty } from '@nestjs/swagger';

/**
 * BLG-13: the itinerary attached to a post, as its page shows it. A summary
 * only: the full public itinerary is at `GET /api/itineraries/public/{id}`.
 */
export class PostItineraryResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0b0b0' })
  id: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({
    type: [String],
    description: 'Country codes of the itinerary',
    example: ['EG'],
  })
  countries: string[];

  @ApiProperty({
    description: 'The first day of the trip, YYYY-MM-DD',
    example: '2026-12-20',
  })
  startDate: string;

  @ApiProperty({ example: 10 })
  dayCount: number;
}
