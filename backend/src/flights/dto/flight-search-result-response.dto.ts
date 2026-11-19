import { ApiProperty, OmitType } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightResponseDto } from './flight-response.dto';

/**
 * FLT-11: a cabin of a search result, one that has enough seats for the
 * party. Its `id` and the flight `id` are what the user selects to continue
 * to the booking. The seat counters stay inside: only `availableSeats`.
 */
export class FlightSearchCabinResponseDto {
  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90789',
    description:
      'Cabin id: with the flight `id`, what the user selects to continue to the booking',
  })
  id: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
    description: 'Cabin category',
  })
  cabin: CabinClass;

  @ApiProperty({
    example: 25000,
    type: 'integer',
    description: 'Price of one seat in minor units of `currency` (cents)',
  })
  price: number;

  @ApiProperty({
    example: PLATFORM_CURRENCY,
    description: `Currency of \`price\`: always the platform currency, ${PLATFORM_CURRENCY} (PAY-04)`,
  })
  currency: string;

  @ApiProperty({
    example: 42,
    type: 'integer',
    description:
      'Seats that can still be booked: the seats of the cabin minus those booked or held for a payment. At least the number of passengers searched for.',
  })
  availableSeats: number;

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

/** FLT-11: the airline of a search result, as a guest sees it (ACC-15: always an active one). */
export class FlightSearchAirlineResponseDto {
  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90123',
    description:
      'Airline id; GET /api/airlines/{id} shows its profile and extra-bag rule',
  })
  id: string;

  @ApiProperty({ example: 'EgyptAir', description: 'Airline name' })
  name: string;

  @ApiProperty({ example: 'MS', description: 'Airline code' })
  code: string;

  @ApiProperty({
    example: '/api/uploads/a1b2c3d4-e5f6-4789-9012-345678abcdef.png',
    description: 'Where the airline logo is served',
  })
  logoUrl: string;
}

/**
 * FLT-11: one flight of a search. The flight as every flight response shows
 * it (UTC times and the local times of GEN-06), with only the cabins that
 * have enough seats for the party, and its airline.
 */
export class FlightSearchResultResponseDto extends OmitType(FlightResponseDto, [
  'cabins',
] as const) {
  @ApiProperty({
    type: FlightSearchAirlineResponseDto,
    description: 'The airline that operates the flight',
  })
  airline: FlightSearchAirlineResponseDto;

  @ApiProperty({
    type: [FlightSearchCabinResponseDto],
    description:
      'Only the cabins with at least as many available seats as the passengers searched for, never empty. A cabin without enough seats is left out.',
  })
  cabins: FlightSearchCabinResponseDto[];
}
