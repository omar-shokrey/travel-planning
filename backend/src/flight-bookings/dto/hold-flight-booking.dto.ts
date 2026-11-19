import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsMongoId,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import {
  FLIGHT_BOOKING_ADULTS_MIN,
  FLIGHT_BOOKING_SEATS_MAX,
} from '../flight-bookings.constants';

const CABIN_VALUES = Object.values(CabinClass).join(', ');

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The passengers of a booking (FLT-12): adults and children take a seat, infants do not. */
export class PassengerCountsDto {
  @ApiProperty({
    description: `Adults, ${FLIGHT_BOOKING_ADULTS_MIN} to ${FLIGHT_BOOKING_SEATS_MAX}. A booking needs at least one adult (FLT-12).`,
    example: 2,
    minimum: FLIGHT_BOOKING_ADULTS_MIN,
    maximum: FLIGHT_BOOKING_SEATS_MAX,
  })
  @IsDefined({ message: 'adults is required' })
  @IsInt({ message: 'adults must be a whole number' })
  @Min(FLIGHT_BOOKING_ADULTS_MIN, {
    message: 'A booking needs at least one adult',
  })
  @Max(FLIGHT_BOOKING_SEATS_MAX, {
    message: `adults must be at most ${FLIGHT_BOOKING_SEATS_MAX}`,
  })
  adults: number;

  @ApiProperty({
    description: `Children, 0 to ${FLIGHT_BOOKING_SEATS_MAX}. Adults and children together take at most ${FLIGHT_BOOKING_SEATS_MAX} seats.`,
    example: 0,
    minimum: 0,
    maximum: FLIGHT_BOOKING_SEATS_MAX,
  })
  @IsDefined({ message: 'children is required' })
  @IsInt({ message: 'children must be a whole number' })
  @Min(0, { message: 'children must be at least 0' })
  @Max(FLIGHT_BOOKING_SEATS_MAX, {
    message: `children must be at most ${FLIGHT_BOOKING_SEATS_MAX}`,
  })
  @ValidateBy({
    name: 'seatsAtMostMax',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean => {
        const adults = (args?.object as PassengerCountsDto | undefined)?.adults;
        // Too many adults on their own is the `adults` field's error.
        return (
          typeof value !== 'number' ||
          typeof adults !== 'number' ||
          adults > FLIGHT_BOOKING_SEATS_MAX ||
          adults + value <= FLIGHT_BOOKING_SEATS_MAX
        );
      },
      defaultMessage: () =>
        `A booking has at most ${FLIGHT_BOOKING_SEATS_MAX} seats (adults and children)`,
    },
  })
  children: number;

  @ApiProperty({
    description:
      'Infants, from 0 up to the number of adults. An infant takes no seat and pays 10% of the fare (FLT-12).',
    example: 1,
    minimum: 0,
    maximum: FLIGHT_BOOKING_SEATS_MAX,
  })
  @IsDefined({ message: 'infants is required' })
  @IsInt({ message: 'infants must be a whole number' })
  @Min(0, { message: 'infants must be at least 0' })
  @ValidateBy({
    name: 'infantsAtMostAdults',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean => {
        const adults = (args?.object as PassengerCountsDto | undefined)?.adults;
        return (
          typeof value !== 'number' ||
          typeof adults !== 'number' ||
          value <= adults
        );
      },
      defaultMessage: () => 'A booking cannot have more infants than adults',
    },
  })
  infants: number;
}

/**
 * FLT-22: what a registered user sends to hold seats and go to payment. The
 * price, the status, the hold, the owner, the seat count and the reference
 * are set by the server: any other field is refused (400). FLT-19 adds the
 * passengers' details and the baggage to this body.
 */
export class HoldFlightBookingDto {
  @ApiProperty({
    description: 'Id of the flight',
    example: '6740f1c2a4b5c6d7e8f90456',
  })
  @IsDefined({ message: 'flightId is required' })
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    description: 'The cabin category of the flight',
    example: CabinClass.Economy,
  })
  @IsDefined({ message: 'cabin is required' })
  @IsEnum(CabinClass, { message: `cabin must be one of: ${CABIN_VALUES}` })
  cabin: CabinClass;

  @ApiProperty({
    type: PassengerCountsDto,
    description: `How many passengers of each type. Seats held = adults + children, at most ${FLIGHT_BOOKING_SEATS_MAX}.`,
  })
  @IsDefined({ message: 'passengers is required' })
  @ValidateBy({
    name: 'passengersIsObject',
    validator: {
      // Without this, ValidateNested walks into a list.
      validate: (value: unknown): boolean =>
        value === undefined || value === null || isPlainObject(value),
      defaultMessage: () => 'passengers must be an object',
    },
  })
  @ValidateNested({ message: 'passengers must be an object' })
  @Type(() => PassengerCountsDto)
  passengers: PassengerCountsDto;
}
