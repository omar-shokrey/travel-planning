import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  AIRPORT_CODE_PATTERN,
  LOCAL_DATE_TIME_PATTERN,
} from '../flights.constants';

const trimmedUppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Validate a field whenever it was sent. `@IsOptional()` would also skip
 * `null`, and no field of a flight may be empty.
 */
const whenSent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * What an airline moderator may change in a scheduled flight of their airline
 * (FLT-05): the times, typed in each airport's local time as in FLT-03, and
 * the airports while the flight has no booking. A field that is left out keeps
 * its value; at least one must be sent (the service answers 400 otherwise).
 * The flight number, the airline, the status, the local departure date and the
 * cabins are not fields here: sending them answers 400. Cabin prices and seat
 * counts are changed with `PATCH /api/flights/:id/cabins/:cabinId` (FLT-04).
 * Not `PartialType(CreateFlightDto)`: that would add `@IsOptional()`, which
 * lets `null` through, and would accept `flightNumber`.
 */
export class UpdateFlightDto {
  @ApiPropertyOptional({
    example: 'CAI',
    pattern: AIRPORT_CODE_PATTERN.source,
    description:
      'New IATA code of the departure airport, from GET /api/airports (FLT-02). Uppercased. Refused (409) once the flight has a booking; the code it already has is not a change and is accepted.',
  })
  @Transform(trimmedUppercase)
  @ValidateIf(whenSent)
  @IsString({ message: 'departureAirport must be a string' })
  @IsNotEmpty({ message: 'departureAirport must not be empty' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'departureAirport must be a 3-letter IATA airport code',
  })
  departureAirport?: string;

  @ApiPropertyOptional({
    example: 'JFK',
    pattern: AIRPORT_CODE_PATTERN.source,
    description:
      'New IATA code of the arrival airport, from GET /api/airports (FLT-02). Must differ from the departure airport. Uppercased. Refused (409) once the flight has a booking; the code it already has is not a change and is accepted.',
  })
  @Transform(trimmedUppercase)
  @ValidateIf(whenSent)
  @IsString({ message: 'arrivalAirport must be a string' })
  @IsNotEmpty({ message: 'arrivalAirport must not be empty' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'arrivalAirport must be a 3-letter IATA airport code',
  })
  arrivalAirport?: string;

  @ApiPropertyOptional({
    example: '2027-06-15T16:30',
    pattern: LOCAL_DATE_TIME_PATTERN.source,
    description:
      "New departure date-time in the departure airport's local time, YYYY-MM-DDTHH:mm (seconds optional), with no Z and no offset, as in POST /api/flights. Stored in UTC. Must be in the future, before the arrival (compared in UTC) and must exist in that time zone. The local departure date is recomputed.",
  })
  @Transform(trimmed)
  @ValidateIf(whenSent)
  @IsString({ message: 'departureLocal must be a string' })
  @IsNotEmpty({ message: 'departureLocal must not be empty' })
  @Matches(LOCAL_DATE_TIME_PATTERN, {
    message:
      'departureLocal must be a local date-time YYYY-MM-DDTHH:mm (seconds optional) with no Z or offset',
  })
  @IsISO8601(
    { strict: true },
    { message: 'departureLocal must be a real calendar date and time' },
  )
  departureLocal?: string;

  @ApiPropertyOptional({
    example: '2027-06-15T20:30',
    pattern: LOCAL_DATE_TIME_PATTERN.source,
    description:
      "New arrival date-time in the arrival airport's local time, YYYY-MM-DDTHH:mm (seconds optional), with no Z and no offset, as in POST /api/flights. Stored in UTC. Must be after the departure (compared in UTC) and must exist in that time zone.",
  })
  @Transform(trimmed)
  @ValidateIf(whenSent)
  @IsString({ message: 'arrivalLocal must be a string' })
  @IsNotEmpty({ message: 'arrivalLocal must not be empty' })
  @Matches(LOCAL_DATE_TIME_PATTERN, {
    message:
      'arrivalLocal must be a local date-time YYYY-MM-DDTHH:mm (seconds optional) with no Z or offset',
  })
  @IsISO8601(
    { strict: true },
    { message: 'arrivalLocal must be a real calendar date and time' },
  )
  arrivalLocal?: string;
}
