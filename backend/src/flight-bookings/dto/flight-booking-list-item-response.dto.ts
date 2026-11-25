import { ApiProperty } from '@nestjs/swagger';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightStatus } from '../../flights/models/flight-status.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import { SegmentSeatsResponseDto } from './booking-seats-response.dto';
import { FlightChangeSummaryDto } from './flight-change-response.dto';

/** FLT-25: the flight of one segment, with its times at each airport (GEN-06). */
export class BookedFlightResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  id: string;

  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirport: string;

  @ApiProperty({ example: 'JFK' })
  arrivalAirport: string;

  @ApiProperty({ example: '2026-12-20T08:00:00.000Z' })
  departureAt: string;

  @ApiProperty({
    example: '2026-12-20T10:00',
    description: 'Departure time at the departure airport',
  })
  departureLocal: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  departureTimeZone: string;

  @ApiProperty({ example: '2026-12-20T20:00:00.000Z' })
  arrivalAt: string;

  @ApiProperty({
    example: '2026-12-20T15:00',
    description: 'Arrival time at the arrival airport',
  })
  arrivalLocal: string;

  @ApiProperty({ example: 'America/New_York' })
  arrivalTimeZone: string;

  @ApiProperty({
    example: '2026-12-20',
    description: 'Departure date at the departure airport',
  })
  departureDateLocal: string;

  @ApiProperty({
    enum: FlightStatus,
    enumName: 'FlightStatus',
    description: 'The flight status now (FLT-30)',
  })
  status: FlightStatus;
}

/** One flight of the booking: outbound first, then the return of a round trip. */
export class FlightBookingListSegmentDto {
  @ApiProperty({ enum: CabinClass, enumName: 'CabinClass' })
  cabin: CabinClass;

  @ApiProperty({ example: 2, description: 'Seats: adults and children' })
  seatsReserved: number;

  @ApiProperty({
    type: BookedFlightResponseDto,
    nullable: true,
    description: 'null only if the flight no longer exists',
  })
  flight: BookedFlightResponseDto | null;
}

export class FlightBookingListPassengerDto {
  @ApiProperty({ example: 'Sara Ahmed' })
  fullName: string;

  @ApiProperty({ enum: PassengerType, enumName: 'PassengerType' })
  type: PassengerType;
}

/** FLT-25: one booking in a list of the user's bookings. */
export class FlightBookingListItemResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'FB7K2Q9M',
    description: 'null while the booking waits for payment',
  })
  reference: string | null;

  @ApiProperty({ enum: FlightBookingStatus, enumName: 'FlightBookingStatus' })
  status: FlightBookingStatus;

  @ApiProperty({ type: [FlightBookingListSegmentDto] })
  segments: FlightBookingListSegmentDto[];

  @ApiProperty({ type: [FlightBookingListPassengerDto] })
  passengers: FlightBookingListPassengerDto[];

  @ApiProperty({ example: 52500, description: 'Minor units (cents)' })
  total: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: '2026-11-19T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'When it was cancelled (FLT-26, FLT-06)',
  })
  cancelledAt: string | null;

  @ApiProperty({
    type: [SegmentSeatsResponseDto],
    description:
      'FLT-28: one entry per segment, in segment order, with the seat of each passenger who takes one',
  })
  seats: SegmentSeatsResponseDto[];

  @ApiProperty({
    type: FlightChangeSummaryDto,
    nullable: true,
    description:
      'FLT-27: the flight change waiting for its payment (pay it before its `holdExpiresAt`), or `null`',
  })
  pendingChange: FlightChangeSummaryDto | null;

  @ApiProperty({
    type: [FlightChangeSummaryDto],
    description:
      'FLT-27: every flight change of the booking, newest first, without their refunds (see the details)',
  })
  changes: FlightChangeSummaryDto[];
}
