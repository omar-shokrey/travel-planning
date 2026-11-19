import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';

/** One flight of a booking as the API returns it (FLT-22). */
export class FlightBookingSegmentResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  flightId: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
  })
  cabin: CabinClass;

  @ApiProperty({
    description:
      'Price of one adult or child seat in minor units, when the seats were held',
    example: 25000,
  })
  fare: number;

  @ApiProperty({
    description: 'Seats held: adults and children (infants take no seat)',
    example: 2,
  })
  seatsReserved: number;
}

/** The passengers of a booking (FLT-12). */
export class PassengerCountsResponseDto {
  @ApiProperty({ example: 2 })
  adults: number;

  @ApiProperty({ example: 0 })
  children: number;

  @ApiProperty({ example: 1 })
  infants: number;
}

/** The extra bags of one passenger (FLT-19). */
export class ExtraBagsResponseDto {
  @ApiProperty({ example: 1 })
  bags: number;

  @ApiProperty({ description: 'Total weight of these bags, kg', example: 20 })
  weightKg: number;
}

/** One passenger of a booking, shown only to the owner (FLT-19). */
export class PassengerResponseDto {
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
    type: ExtraBagsResponseDto,
    nullable: true,
    description: 'The extra bags of this passenger; `null` when none',
  })
  extraBags: ExtraBagsResponseDto | null;
}

/** A flight booking as the API returns it to its owner (FLT-22, FLT-19). */
export class FlightBookingResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  id: string;

  @ApiPropertyOptional({
    description:
      'The booking reference, given once the payment succeeds (FLT-23). Absent before.',
    example: 'FB7K2Q9M',
  })
  reference?: string;

  @ApiProperty({
    enum: FlightBookingStatus,
    enumName: 'FlightBookingStatus',
    example: FlightBookingStatus.PendingPayment,
  })
  status: FlightBookingStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'UTC end of the 10-minute seat hold while the payment is pending; `null` otherwise',
    example: '2026-11-19T10:10:00.000Z',
  })
  holdExpiresAt: string | null;

  @ApiProperty({ description: 'The platform currency', example: 'USD' })
  currency: string;

  @ApiProperty({
    description:
      'Fares of every seat and every infant (10% of the fare each), in minor units',
    example: 52500,
  })
  fareTotal: number;

  @ApiProperty({
    description:
      "Extra bag fees of every passenger in minor units: bags × the airline's extra bag price (FLT-19)",
    example: 0,
  })
  baggageTotal: number;

  @ApiProperty({
    description: 'What the user pays in minor units: fareTotal + baggageTotal',
    example: 52500,
  })
  total: number;

  @ApiProperty({ type: [FlightBookingSegmentResponseDto] })
  segments: FlightBookingSegmentResponseDto[];

  @ApiProperty({
    type: PassengerCountsResponseDto,
    description: 'How many passengers of each type, derived from passengers',
  })
  passengerCounts: PassengerCountsResponseDto;

  @ApiProperty({ type: [PassengerResponseDto] })
  passengers: PassengerResponseDto[];

  @ApiProperty({ example: '2026-11-19T10:00:00.000Z' })
  createdAt: string;
}
