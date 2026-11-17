import { ApiProperty } from '@nestjs/swagger';

/** A room that is free for the whole searched stay (HTL-15). */
export class AvailableRoomResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90124' })
  id: string;

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

  @ApiProperty({ example: 3, minimum: 1, description: 'Nights of the stay' })
  nights: number;

  @ApiProperty({
    example: 37500,
    minimum: 1,
    description: 'Total price of the stay in minor units: nights x price',
  })
  totalPrice: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}
