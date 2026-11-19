import { ApiProperty, OmitType } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { CabinClass } from '../models/cabin-class.enum';
import { CancellationTierResponseDto } from './cancellation-tier-response.dto';
import { FlightResponseDto } from './flight-response.dto';
import { FlightSearchAirlineResponseDto } from './flight-search-result-response.dto';

/**
 * FLT-17: a cabin category on the flight details page. The seat counters stay
 * inside: only `seatsRemaining`.
 */
export class FlightDetailsCabinResponseDto {
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
    minimum: 0,
    description:
      'Seats that can still be booked: the seats of the cabin minus those booked and those held for a payment, never below 0',
  })
  seatsRemaining: number;

  @ApiProperty({
    example: 1,
    type: 'integer',
    description: 'Free checked bags per passenger (the baggage allowance)',
  })
  freeBags: number;

  @ApiProperty({
    example: 23,
    type: 'integer',
    description:
      'Maximum weight of one bag in kg, for the free bags and for each extra bag (FLT-08)',
  })
  maxBagKg: number;
}

/**
 * FLT-17: the flight details page. The flight as every flight response shows
 * it (UTC times and the local times of GEN-06, the status of FLT-30), with its
 * airline, its duration, every cabin category, the airline's extra-bag rule
 * (FLT-08) and its cancellation policy (FLT-09).
 */
export class FlightDetailsResponseDto extends OmitType(FlightResponseDto, [
  'airlineId',
  'cabins',
  'createdAt',
  'updatedAt',
] as const) {
  @ApiProperty({
    type: FlightSearchAirlineResponseDto,
    description: 'The airline that operates the flight',
  })
  airline: FlightSearchAirlineResponseDto;

  @ApiProperty({
    example: 660,
    type: 'integer',
    description:
      'Duration in whole minutes: the arrival minus the departure, both in UTC, so time zones and daylight saving do not change it',
  })
  durationMinutes: number;

  @ApiProperty({
    type: [FlightDetailsCabinResponseDto],
    description:
      'Every cabin category of the flight, with its price, the seats remaining and the baggage allowance. Empty while the airline has defined none (FLT-04).',
  })
  cabins: FlightDetailsCabinResponseDto[];

  @ApiProperty({
    example: 4500,
    type: 'integer',
    nullable: true,
    description:
      'Price of one extra bag in minor units of `extraBagCurrency` (cents), set by the airline (FLT-08); null when the airline sells no extra bag. An extra bag weighs at most the `maxBagKg` of the cabin.',
  })
  extraBagPrice: number | null;

  @ApiProperty({
    example: PLATFORM_CURRENCY,
    description: `Currency of \`extraBagPrice\`: always the platform currency, ${PLATFORM_CURRENCY} (PAY-04)`,
  })
  extraBagCurrency: string;

  @ApiProperty({
    example: 2,
    type: 'integer',
    description:
      'Most extra bags one passenger may buy (FLT-08); 0 when the airline sells none',
  })
  maxExtraBags: number;

  @ApiProperty({
    type: [CancellationTierResponseDto],
    description:
      "The airline's cancellation policy (FLT-09): refund percentages by days before departure. Empty when the airline has defined none.",
  })
  cancellationTiers: CancellationTierResponseDto[];
}
