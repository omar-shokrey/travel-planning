import { ApiProperty } from '@nestjs/swagger';
import { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import {
  ExtraBagsResponseDto,
  PassengerCountsResponseDto,
} from './flight-booking-response.dto';

/** FLT-21: the fixed reminder that the summary holds nothing. */
export const SUMMARY_PRICE_NOTE =
  'Prices and seats are confirmed when you proceed to payment (POST /api/flight-bookings/hold).';

/** The airline of the flight (FLT-01): public profile fields only. */
export class SummaryAirlineDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90999' })
  id: string;

  @ApiProperty({ example: 'Nile Air' })
  name: string;

  @ApiProperty({ example: 'NP' })
  code: string;
}

/** One passenger of the summary, with what they pay (FLT-19, FLT-12). */
export class SummaryPassengerDto {
  @ApiProperty({ example: 'Sara Ahmed' })
  fullName: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '1990-05-14' })
  dateOfBirth: string;

  @ApiProperty({
    enum: PassengerType,
    enumName: 'PassengerType',
    description:
      'Derived by the server from the date of birth on the departure date (FLT-12)',
    example: PassengerType.Adult,
  })
  type: PassengerType;

  @ApiProperty({ example: 'A12345678' })
  passportNumber: string;

  @ApiProperty({
    description:
      'The fare of this passenger in minor units: the cabin price, or 10% of it (rounded) for an infant',
    example: 25000,
  })
  fare: number;

  @ApiProperty({
    type: ExtraBagsResponseDto,
    nullable: true,
    description: 'The extra bags of this passenger; `null` when none',
  })
  extraBags: ExtraBagsResponseDto | null;

  @ApiProperty({
    description:
      "Fee of the extra bags in minor units: bags × the airline's extra bag price; 0 without bags",
    example: 9000,
  })
  baggageFee: number;
}

/** The baggage rule the summary prices with (FLT-04, FLT-08). */
export class SummaryBaggageDto {
  @ApiProperty({
    description: 'Free checked bags per passenger in this cabin',
    example: 1,
  })
  freeBags: number;

  @ApiProperty({
    description: 'Maximum weight of one bag in kg, free or extra',
    example: 23,
  })
  maxBagKg: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Price of one extra bag in minor units; `null` when the airline sells no extra bags',
    example: 4500,
  })
  extraBagPrice: number | null;

  @ApiProperty({
    description: 'Most extra bags one passenger may buy; 0 means none',
    example: 2,
  })
  maxExtraBags: number;
}

/**
 * FLT-21: what the user will book and pay, shown before payment. Nothing is
 * held or saved: there is no id, status, hold time or reference.
 */
export class FlightBookingSummaryResponseDto {
  @ApiProperty({
    type: FlightResponseDto,
    description:
      'The flight with its UTC times and the local times at each airport (GEN-06)',
  })
  flight: FlightResponseDto;

  @ApiProperty({ type: SummaryAirlineDto })
  airline: SummaryAirlineDto;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
  })
  cabin: CabinClass;

  @ApiProperty({
    description: 'Seats the booking needs: adults and children',
    example: 3,
  })
  seats: number;

  @ApiProperty({ type: PassengerCountsResponseDto })
  passengerCounts: PassengerCountsResponseDto;

  @ApiProperty({ type: [SummaryPassengerDto] })
  passengers: SummaryPassengerDto[];

  @ApiProperty({ type: SummaryBaggageDto })
  baggage: SummaryBaggageDto;

  @ApiProperty({ description: 'The platform currency', example: 'USD' })
  currency: string;

  @ApiProperty({
    description: 'Fares of every passenger in minor units',
    example: 77500,
  })
  fareTotal: number;

  @ApiProperty({
    description: 'Extra bag fees of every passenger in minor units',
    example: 9000,
  })
  baggageTotal: number;

  @ApiProperty({
    description:
      'What the user will pay in minor units: fareTotal + baggageTotal',
    example: 86500,
  })
  total: number;

  @ApiProperty({ example: SUMMARY_PRICE_NOTE })
  priceNote: string;
}
