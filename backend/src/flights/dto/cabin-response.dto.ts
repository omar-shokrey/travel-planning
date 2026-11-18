import { ApiProperty } from '@nestjs/swagger';
import { CabinClass } from '../models/cabin-class.enum';

/**
 * Public fields of a cabin category (FLT-04). The seat counters behind
 * `availableSeats` (seats booked, seats held for a payment) are internal and
 * never returned.
 */
export class CabinResponseDto {
  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90789',
    description:
      'Cabin id, the `cabinId` of PATCH /api/flights/{id}/cabins/{cabinId}',
  })
  id: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
    description: 'Cabin category, at most once per flight',
  })
  cabin: CabinClass;

  @ApiProperty({
    example: 180,
    type: 'integer',
    description: 'Number of seats in this cabin',
  })
  totalSeats: number;

  @ApiProperty({
    example: 180,
    type: 'integer',
    description:
      'Seats that can still be booked: the seats of the cabin minus those booked or held for a payment',
  })
  availableSeats: number;

  @ApiProperty({
    example: 25000,
    type: 'integer',
    description: 'Price of one seat in minor units of `currency` (cents)',
  })
  price: number;

  @ApiProperty({
    example: 'USD',
    description:
      'Currency of `price`: always the platform currency, USD (PAY-04)',
  })
  currency: string;

  @ApiProperty({
    example: 1,
    type: 'integer',
    description: 'Free checked bags per passenger (0 means none)',
  })
  freeBags: number;

  @ApiProperty({
    example: 23,
    type: 'integer',
    description:
      'Maximum weight of one bag in kg, for the free bags and for any extra bag (FLT-08)',
  })
  maxBagKg: number;
}
