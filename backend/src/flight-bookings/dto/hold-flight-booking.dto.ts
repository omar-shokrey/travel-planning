import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { DateTime } from 'luxon';
import { MAX_EXTRA_BAGS_MAX } from '../../flights/flights.constants';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import {
  ADULT_MIN_AGE,
  CHILD_MIN_AGE,
  FLIGHT_BOOKING_PASSENGERS_MAX,
  FLIGHT_BOOKING_SEATS_MAX,
  PASSENGER_FULL_NAME_MAX_LENGTH,
  PASSENGER_FULL_NAME_MIN_LENGTH,
  PASSENGER_MAX_AGE_YEARS,
  PASSPORT_NUMBER_MAX_LENGTH,
  PASSPORT_NUMBER_MIN_LENGTH,
  PASSPORT_NUMBER_PATTERN,
} from '../flight-bookings.constants';

const CABIN_VALUES = Object.values(CabinClass).join(', ');
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Today's date in UTC (`YYYY-MM-DD`). */
const todayUtc = (): string => DateTime.utc().toISODate() as string;

/** The earliest date of birth we accept: 120 years before today (UTC). */
const earliestDateOfBirth = (): string =>
  DateTime.utc()
    .minus({ years: PASSENGER_MAX_AGE_YEARS })
    .toISODate() as string;

/**
 * A `YYYY-MM-DD` date that is not after today and not more than 120 years
 * back. Only checked once the value has the date form (the other decorators
 * report the format). The messages never repeat the value: it is personal.
 */
const DateOfBirthInRange = () =>
  ValidateBy({
    name: 'dateOfBirthInRange',
    validator: {
      validate: (value: unknown): boolean =>
        typeof value !== 'string' ||
        !DATE_ONLY_PATTERN.test(value) ||
        (value <= todayUtc() && value >= earliestDateOfBirth()),
      defaultMessage: () =>
        `dateOfBirth cannot be in the future or more than ${PASSENGER_MAX_AGE_YEARS} years ago`,
    },
  });

/** FLT-19: the extra bags of one passenger, on the one flight of the booking. */
export class ExtraBagsDto {
  @ApiProperty({
    description: `How many extra bags, a whole number from 1 to the airline's maxExtraBags (at most ${MAX_EXTRA_BAGS_MAX}). Each one costs the airline's extraBagPrice. An airline that sells no extra bag answers 400.`,
    minimum: 1,
    maximum: MAX_EXTRA_BAGS_MAX,
  })
  @IsDefined({ message: 'bags is required' })
  @IsInt({ message: 'bags must be a whole number' })
  @Min(1, { message: 'bags must be at least 1' })
  @Max(MAX_EXTRA_BAGS_MAX, {
    message: `bags must be at most ${MAX_EXTRA_BAGS_MAX}`,
  })
  bags: number;

  @ApiProperty({
    description:
      "Total weight in kg of this passenger's extra bags, a whole number of 1 or more, at most bags × the cabin's maxBagKg (each extra bag has the cabin's maximum weight, FLT-08).",
    minimum: 1,
  })
  @IsDefined({ message: 'weightKg is required' })
  @IsInt({ message: 'weightKg must be a whole number' })
  @Min(1, { message: 'weightKg must be at least 1' })
  weightKg: number;
}

/**
 * FLT-19: one passenger. The type (adult, child, infant) is never sent: the
 * server derives it from the date of birth on the departure date (FLT-12(b)).
 * No message repeats a value, because they are personal data.
 */
export class PassengerDetailsDto {
  @ApiProperty({
    description: `Full name as on the passport, ${PASSENGER_FULL_NAME_MIN_LENGTH} to ${PASSENGER_FULL_NAME_MAX_LENGTH} characters`,
    example: 'Sara Ahmed',
    minLength: PASSENGER_FULL_NAME_MIN_LENGTH,
    maxLength: PASSENGER_FULL_NAME_MAX_LENGTH,
  })
  @Transform(trim)
  @IsDefined({ message: 'fullName is required' })
  @IsString({ message: 'fullName must be text' })
  @Length(PASSENGER_FULL_NAME_MIN_LENGTH, PASSENGER_FULL_NAME_MAX_LENGTH, {
    message: `fullName must have ${PASSENGER_FULL_NAME_MIN_LENGTH} to ${PASSENGER_FULL_NAME_MAX_LENGTH} characters`,
  })
  fullName: string;

  @ApiProperty({
    description: `Date of birth, YYYY-MM-DD: a real calendar date, not in the future and not more than ${PASSENGER_MAX_AGE_YEARS} years back. On the flight's local departure date it gives the type: adult ${ADULT_MIN_AGE} or older, child ${CHILD_MIN_AGE} to ${ADULT_MIN_AGE - 1}, infant younger than ${CHILD_MIN_AGE} (FLT-12).`,
    example: '1990-05-14',
  })
  @IsDefined({ message: 'dateOfBirth is required' })
  @IsString({ message: 'dateOfBirth must be a date in the form YYYY-MM-DD' })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateOfBirth must be a date in the form YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'dateOfBirth must be a real calendar date' },
  )
  @DateOfBirthInRange()
  dateOfBirth: string;

  @ApiProperty({
    description: `Passport or ID number: ${PASSPORT_NUMBER_MIN_LENGTH} to ${PASSPORT_NUMBER_MAX_LENGTH} letters and digits, stored in upper case. Each passenger of a booking has a different one.`,
    example: 'A12345678',
    minLength: PASSPORT_NUMBER_MIN_LENGTH,
    maxLength: PASSPORT_NUMBER_MAX_LENGTH,
  })
  @Transform(trimUpper)
  @IsDefined({ message: 'passportNumber is required' })
  @IsString({ message: 'passportNumber must be text' })
  @Length(PASSPORT_NUMBER_MIN_LENGTH, PASSPORT_NUMBER_MAX_LENGTH, {
    message: `passportNumber must have ${PASSPORT_NUMBER_MIN_LENGTH} to ${PASSPORT_NUMBER_MAX_LENGTH} characters`,
  })
  @Matches(PASSPORT_NUMBER_PATTERN, {
    message: 'passportNumber must contain only letters and digits',
  })
  passportNumber: string;

  @ApiPropertyOptional({
    type: ExtraBagsDto,
    description:
      "Optional extra bags for this passenger, up to the airline's maximum. The fee, bags × the airline's extraBagPrice, is added to the booking total. Leave it out for no extra bag.",
  })
  // Left out (or null) means no extra bag.
  @IsOptional()
  @ValidateBy({
    name: 'extraBagsIsObject',
    validator: {
      validate: (value: unknown): boolean => isPlainObject(value),
      defaultMessage: () => 'extraBags must be an object',
    },
  })
  @ValidateNested({ message: 'extraBags must be an object' })
  @Type(() => ExtraBagsDto)
  extraBags?: ExtraBagsDto;
}

/**
 * FLT-22 and FLT-19: what a registered user sends to hold seats and go to
 * payment. The passenger types, the price, the baggage fee, the status, the
 * hold, the owner, the seat count and the reference are set by the server:
 * any other field is refused (400).
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
    type: [PassengerDetailsDto],
    description: `Every passenger, 1 to ${FLIGHT_BOOKING_PASSENGERS_MAX}. The server derives each type from the date of birth on the departure date: at least one adult, no more infants than adults, at most ${FLIGHT_BOOKING_SEATS_MAX} adults and children together (they take the seats; an infant takes none and pays 10% of the fare).`,
    minItems: 1,
    maxItems: FLIGHT_BOOKING_PASSENGERS_MAX,
  })
  @IsDefined({ message: 'passengers is required' })
  @IsArray({ message: 'passengers must be a list' })
  @ArrayMinSize(1, { message: 'passengers must have at least 1 passenger' })
  @ArrayMaxSize(FLIGHT_BOOKING_PASSENGERS_MAX, {
    message: `passengers must have at most ${FLIGHT_BOOKING_PASSENGERS_MAX} passengers`,
  })
  @ValidateBy({
    name: 'passengersAreObjects',
    validator: {
      // Without this, ValidateNested walks into a passenger sent as a list.
      validate: (value: unknown): boolean =>
        !Array.isArray(value) || value.every(isPlainObject),
      defaultMessage: () => 'Each passenger must be an object',
    },
  })
  @ValidateNested({ each: true })
  @Type(() => PassengerDetailsDto)
  passengers: PassengerDetailsDto[];
}
