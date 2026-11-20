import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  FLIGHT_BOOKING_PASSENGERS_MAX,
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_BOOKING_SEGMENTS_MAX,
} from '../flight-bookings.constants';
import { SEAT_NUMBER_PATTERN } from '../seat-map';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether no two seats of the list share `field`. Elements that are not
 * objects, or have no value there, are left to the other rules.
 */
const isEachOnce = (value: unknown, field: string): boolean => {
  if (!Array.isArray(value)) return true;
  const seen = value
    .filter(isPlainObject)
    .map((seat) => seat[field])
    .filter((named) => named !== undefined && named !== null);
  return new Set(seen).size === seen.length;
};

/** FLT-28: one passenger's seat on the chosen segment. */
export class SeatChoiceDto {
  @ApiProperty({
    description:
      'The position of the passenger in `passengers` of the booking, from 0. An infant takes no seat.',
    minimum: 0,
    maximum: FLIGHT_BOOKING_PASSENGERS_MAX - 1,
    example: 0,
  })
  @IsDefined({ message: 'passengerIndex is required' })
  @IsInt({ message: 'passengerIndex must be a whole number' })
  @Min(0, { message: 'passengerIndex must be 0 or more' })
  @Max(FLIGHT_BOOKING_PASSENGERS_MAX - 1, {
    message: `passengerIndex must be at most ${FLIGHT_BOOKING_PASSENGERS_MAX - 1}`,
  })
  passengerIndex: number;

  @ApiProperty({
    description:
      'A seat of the seat map of the booked cabin (GET /api/flight-bookings/{id}/seat-map): a row number and a seat letter.',
    pattern: SEAT_NUMBER_PATTERN.source,
    example: '12C',
  })
  @IsDefined({ message: 'seatNumber is required' })
  @IsString({ message: 'seatNumber must be a text' })
  @Matches(SEAT_NUMBER_PATTERN, {
    message:
      'seatNumber must be a row number and a seat letter, for example 12C',
  })
  seatNumber: string;
}

/**
 * FLT-28: PATCH /api/flight-bookings/:id/seat. The seats of some or all
 * passengers on one segment. The cabin is the booking's: it is never sent.
 */
export class SelectSeatsDto {
  @ApiPropertyOptional({
    description:
      'Which flight of the booking: 0 the outbound, 1 the return. Required for a round trip; a one-way booking may leave it out.',
    minimum: 0,
    maximum: FLIGHT_BOOKING_SEGMENTS_MAX - 1,
    example: 0,
  })
  // Only a sent value is checked, so null answers 400 instead of meaning "left out".
  @ValidateIf((body: SelectSeatsDto) => body.segmentIndex !== undefined)
  @IsInt({ message: 'segmentIndex must be a whole number' })
  @Min(0, { message: 'segmentIndex must be 0 or more' })
  @Max(FLIGHT_BOOKING_SEGMENTS_MAX - 1, {
    message: `segmentIndex must be at most ${FLIGHT_BOOKING_SEGMENTS_MAX - 1}`,
  })
  segmentIndex?: number;

  @ApiProperty({
    type: [SeatChoiceDto],
    description: `1 to ${FLIGHT_BOOKING_SEATS_MAX} seats, each passenger and each seat at most once. All or nothing: if one seat cannot be given, no passenger changes seat. Every seat must be free when the request starts, except a passenger's own current seat, so two passengers cannot swap seats in one request (choose a free seat for one of them first).`,
    minItems: 1,
    maxItems: FLIGHT_BOOKING_SEATS_MAX,
    example: [
      { passengerIndex: 0, seatNumber: '12C' },
      { passengerIndex: 1, seatNumber: '12D' },
    ],
  })
  @IsDefined({ message: 'seats is required' })
  @IsArray({ message: 'seats must be a list' })
  @ArrayMinSize(1, { message: 'seats must have at least 1 seat' })
  @ArrayMaxSize(FLIGHT_BOOKING_SEATS_MAX, {
    message: `seats must have at most ${FLIGHT_BOOKING_SEATS_MAX} seats`,
  })
  @ValidateBy({
    name: 'seatsAreObjects',
    validator: {
      // Without this, ValidateNested walks into a seat sent as a list.
      validate: (value: unknown): boolean =>
        !Array.isArray(value) || value.every(isPlainObject),
      defaultMessage: () => 'Each seat must be an object',
    },
  })
  @ValidateBy({
    name: 'seatsNameEachPassengerOnce',
    validator: {
      validate: (value: unknown): boolean =>
        isEachOnce(value, 'passengerIndex'),
      defaultMessage: () => 'seats must name each passenger at most once',
    },
  })
  @ValidateBy({
    name: 'seatsNameEachSeatOnce',
    validator: {
      validate: (value: unknown): boolean => isEachOnce(value, 'seatNumber'),
      defaultMessage: () => 'seats must name each seat at most once',
    },
  })
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats: SeatChoiceDto[];
}
