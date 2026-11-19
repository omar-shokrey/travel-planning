import { ApiProperty } from '@nestjs/swagger';
import { HotelSearchResultResponseDto } from '../../hotels/dto/hotel-search-result-response.dto';

/**
 * ITN-25: a hotel of hotel search (HTL-11) with the stay that was searched,
 * the dates of the city group. Pass the same two dates to the hotel page
 * (`GET /api/hotels/:id`) or to its free rooms (`GET /api/hotels/:id/rooms/available`).
 */
export class ItineraryHotelResponseDto extends HotelSearchResultResponseDto {
  @ApiProperty({
    description: 'Check-in: the date of the first day of the city group',
    example: '2026-12-20',
  })
  checkIn: string;

  @ApiProperty({
    description: 'Check-out: the day after the last day of the city group',
    example: '2026-12-23',
  })
  checkOut: string;
}
