import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  AIRPORT_CODE_PATTERN,
  FLIGHT_NUMBER_PATTERN,
  LOCAL_DATE_TIME_PATTERN,
} from '../flights.constants';

const trimmedUppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What an airline moderator sends to create a flight (FLT-03). The airline
 * comes from the moderator's assignment and the status is set by the server,
 * so neither is a field here: sending them answers 400.
 */
export class CreateFlightDto {
  @ApiProperty({
    example: 'MS123',
    pattern: FLIGHT_NUMBER_PATTERN.source,
    description:
      'Flight number: 2 to 10 letters or digits. Outer spaces are removed and letters are uppercased, so " ms123 " is MS123. Unique per airline and departure date.',
  })
  @Transform(trimmedUppercase)
  @IsString({ message: 'flightNumber must be a string' })
  @IsNotEmpty({ message: 'flightNumber must not be empty' })
  @Matches(FLIGHT_NUMBER_PATTERN, {
    message: 'flightNumber must be 2 to 10 uppercase letters or digits',
  })
  flightNumber: string;

  @ApiProperty({
    example: 'CAI',
    pattern: AIRPORT_CODE_PATTERN.source,
    description:
      'IATA code of the departure airport, from GET /api/airports (FLT-02). Uppercased.',
  })
  @Transform(trimmedUppercase)
  @IsString({ message: 'departureAirport must be a string' })
  @IsNotEmpty({ message: 'departureAirport must not be empty' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'departureAirport must be a 3-letter IATA airport code',
  })
  departureAirport: string;

  @ApiProperty({
    example: 'JFK',
    pattern: AIRPORT_CODE_PATTERN.source,
    description:
      'IATA code of the arrival airport, from GET /api/airports (FLT-02). Must differ from the departure airport. Uppercased.',
  })
  @Transform(trimmedUppercase)
  @IsString({ message: 'arrivalAirport must be a string' })
  @IsNotEmpty({ message: 'arrivalAirport must not be empty' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'arrivalAirport must be a 3-letter IATA airport code',
  })
  arrivalAirport: string;

  @ApiProperty({
    example: '2027-06-15T14:30',
    pattern: LOCAL_DATE_TIME_PATTERN.source,
    description:
      "Departure date-time in the departure airport's local time, YYYY-MM-DDTHH:mm (seconds optional), with no Z and no offset. Stored in UTC. Must be in the future, and must exist in that time zone (not inside a clock change that skips it).",
  })
  @Transform(trimmed)
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
  departureLocal: string;

  @ApiProperty({
    example: '2027-06-15T18:30',
    pattern: LOCAL_DATE_TIME_PATTERN.source,
    description:
      "Arrival date-time in the arrival airport's local time, YYYY-MM-DDTHH:mm (seconds optional), with no Z and no offset. Stored in UTC. Must be after the departure, compared in UTC, and must exist in that time zone.",
  })
  @Transform(trimmed)
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
  arrivalLocal: string;
}
