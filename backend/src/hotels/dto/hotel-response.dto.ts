import { ApiProperty } from '@nestjs/swagger';

export class HotelPhotoResponseDto {
  @ApiProperty({ example: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg' })
  filename: string;

  @ApiProperty({
    example: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  url: string;
}

export class HotelResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: 'Cairo Garden Hotel' })
  name: string;

  @ApiProperty({ example: '12 Nile Street' })
  addressLine: string;

  @ApiProperty({ example: 'city_001' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 'A quiet hotel close to the city centre.' })
  description: string;

  @ApiProperty({ type: HotelPhotoResponseDto, isArray: true })
  photos: HotelPhotoResponseDto[];

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  starClass: number;

  @ApiProperty({ example: ['wifi', 'pool'], type: [String] })
  amenities: string[];

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: 12, minimum: 0 })
  ratingCount: number;

  @ApiProperty({ example: 4.5, minimum: 0, maximum: 5 })
  averageRating: number;

  @ApiProperty({ example: '2026-11-05T11:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-05T11:00:00.000Z' })
  updatedAt: string;
}
