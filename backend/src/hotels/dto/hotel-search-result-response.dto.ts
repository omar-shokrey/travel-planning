import { ApiProperty } from '@nestjs/swagger';
import { HotelResponseDto } from './hotel-response.dto';

/** HTL-11: a hotel that can take the search, with what it has free. */
export class HotelSearchResultResponseDto extends HotelResponseDto {
  @ApiProperty({
    example: 4,
    minimum: 1,
    description:
      'How many active rooms are free for every night of the stay. At least the number of rooms searched for.',
  })
  freeRooms: number;

  @ApiProperty({
    example: 9500,
    minimum: 1,
    description:
      'The lowest price per night of those free rooms, in minor units of `currency`',
  })
  lowestPricePerNight: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}
