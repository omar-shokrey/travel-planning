import { ApiProperty } from '@nestjs/swagger';
import { HotelPhotoResponseDto } from './hotel-response.dto';

/** One hotel of the search results (HTL-11). */
export class HotelSearchResultResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: 'Cairo Garden Hotel' })
  name: string;

  @ApiProperty({ example: '12 Nile Street' })
  addressLine: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  starClass: number;

  @ApiProperty({ type: [String], example: ['wifi', 'pool'] })
  amenities: string[];

  @ApiProperty({ type: [HotelPhotoResponseDto] })
  photos: HotelPhotoResponseDto[];

  @ApiProperty({
    example: 4.5,
    description: 'Average rating from 1 to 5; 0 while the hotel has none',
  })
  averageRating: number;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({
    example: 4,
    minimum: 1,
    description: 'How many rooms are free for the whole stay',
  })
  freeRooms: number;

  @ApiProperty({
    example: 9000,
    minimum: 1,
    description:
      'Price per night of the cheapest room that is free for the stay, in minor units',
  })
  cheapestPricePerNight: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}
