import { ApiProperty } from '@nestjs/swagger';

export class RoomResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90124' })
  hotelId: string;

  @ApiProperty({ example: '101' })
  number: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 2, minimum: 1 })
  beds: number;

  @ApiProperty({ example: 3, minimum: 1 })
  maxOccupancy: number;

  @ApiProperty({
    example: 12500,
    minimum: 1,
    description: 'Price per night in minor units',
  })
  pricePerNight: number;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: '2026-11-05T11:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-05T11:00:00.000Z' })
  updatedAt: string;
}
