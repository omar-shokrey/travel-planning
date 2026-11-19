import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { ROOM_PRICE_MAX, ROOM_QUERY_MAX_NIGHTS } from '../hotels.constants';

/** A room that is free for the whole searched stay (HTL-15). */
export class AvailableRoomResponseDto {
  @ApiProperty({
    description:
      'Room id. This is the id a reservation (HTL-16) selects the room by.',
    example: '6740f1c2a4b5c6d7e8f90124',
  })
  id: string;

  @ApiProperty({
    description: 'Room number, unique within the hotel',
    example: '101',
  })
  number: string;

  @ApiProperty({ description: 'Room type', example: 'Double' })
  type: string;

  @ApiProperty({ description: 'Number of beds', example: 2, minimum: 1 })
  beds: number;

  @ApiProperty({
    description: 'Maximum number of guests the room takes',
    example: 3,
    minimum: 1,
  })
  maxOccupancy: number;

  @ApiProperty({
    description:
      'Price per night in minor units of `currency` (12500 = 125.00 USD)',
    example: 12500,
    minimum: 1,
    maximum: ROOM_PRICE_MAX,
  })
  pricePerNight: number;

  @ApiProperty({
    description:
      'Nights of the stay: from checkIn up to the day before checkOut',
    example: 3,
    minimum: 1,
    maximum: ROOM_QUERY_MAX_NIGHTS,
  })
  nights: number;

  @ApiProperty({
    description:
      'Total price of the stay in minor units of `currency`: nights x pricePerNight',
    example: 37500,
    minimum: 1,
  })
  totalPrice: number;

  @ApiProperty({
    description: 'Currency of the prices (the platform currency, PAY-04)',
    example: PLATFORM_CURRENCY,
  })
  currency: string;
}
