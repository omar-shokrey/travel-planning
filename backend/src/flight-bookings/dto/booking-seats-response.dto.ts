import { ApiProperty } from '@nestjs/swagger';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import { SeatStatus } from '../enums/seat-status.enum';

/** FLT-28: the seat of one passenger on one segment. */
export class PassengerSeatResponseDto {
  @ApiProperty({
    description: 'The position of the passenger in `passengers`',
    example: 0,
  })
  passengerIndex: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The chosen seat, or null when none is chosen yet',
    example: '12C',
  })
  seatNumber: string | null;
}

/** FLT-28: the seats of one segment of a booking. */
export class SegmentSeatsResponseDto {
  @ApiProperty({
    description: '0 the outbound flight, 1 the return',
    example: 0,
  })
  segmentIndex: number;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  flightId: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
  })
  cabin: CabinClass;

  @ApiProperty({
    type: [PassengerSeatResponseDto],
    description:
      'Every passenger who takes a seat (adults and children; an infant takes none), with their seat',
  })
  passengers: PassengerSeatResponseDto[];
}

/** FLT-28: one seat of a cabin as the owner of a booking sees it. */
export class SeatMapSeatResponseDto {
  @ApiProperty({ example: '12C' })
  seatNumber: string;

  @ApiProperty({
    enum: SeatStatus,
    enumName: 'SeatStatus',
    description:
      '`yours`: held by a passenger of this booking; `taken`: held by someone else (who is never shown); `available`: free',
    example: SeatStatus.Available,
  })
  status: SeatStatus;
}

/** FLT-28: the seat map of one segment's cabin. */
export class SeatMapSegmentResponseDto {
  @ApiProperty({
    description: '0 the outbound flight, 1 the return',
    example: 0,
  })
  segmentIndex: number;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  flightId: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    description: 'The booked cabin',
    example: CabinClass.Economy,
  })
  cabin: CabinClass;

  @ApiProperty({
    type: [SeatMapSeatResponseDto],
    description:
      'Every seat of the cabin, row by row, as many as the cabin has seats',
  })
  seats: SeatMapSeatResponseDto[];
}

/** FLT-28: a passenger of the booking and their seat on each segment. */
export class SeatMapPassengerResponseDto {
  @ApiProperty({ example: 0 })
  passengerIndex: number;

  @ApiProperty({ example: 'Sara Ahmed' })
  fullName: string;

  @ApiProperty({
    enum: PassengerType,
    enumName: 'PassengerType',
    example: PassengerType.Adult,
  })
  type: PassengerType;

  @ApiProperty({
    description: 'false for an infant, who takes no seat',
    example: true,
  })
  needsSeat: boolean;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', nullable: true },
    description:
      'The seat on each segment, in segment order: null when none is chosen (always null for an infant)',
    example: ['12C'],
  })
  seats: (string | null)[];
}

/** FLT-28: GET /api/flight-bookings/:id/seat-map. */
export class SeatMapResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  bookingId: string;

  @ApiProperty({ type: [SeatMapSegmentResponseDto] })
  segments: SeatMapSegmentResponseDto[];

  @ApiProperty({ type: [SeatMapPassengerResponseDto] })
  passengers: SeatMapPassengerResponseDto[];
}
