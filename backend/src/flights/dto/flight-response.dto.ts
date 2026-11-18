import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus } from '../models/flight-status.enum';

/** Public fields of a flight (FLT-03). Times are UTC; `departureDateLocal` is the local date. */
export class FlightResponseDto {
  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90456',
    description: 'Flight id',
  })
  id: string;

  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90123',
    description:
      "Id of the airline that operates the flight: the moderator's assigned airline",
  })
  airlineId: string;

  @ApiProperty({ example: 'MS123', description: 'Flight number, uppercase' })
  flightNumber: string;

  @ApiProperty({
    example: 'CAI',
    description: 'IATA code of the departure airport',
  })
  departureAirport: string;

  @ApiProperty({
    example: 'JFK',
    description: 'IATA code of the arrival airport',
  })
  arrivalAirport: string;

  @ApiProperty({
    example: '2027-06-15T11:30:00.000Z',
    description:
      'Departure moment in UTC (the local time converted with the departure airport time zone)',
  })
  departureAt: string;

  @ApiProperty({
    example: '2027-06-15T22:30:00.000Z',
    description:
      'Arrival moment in UTC (the local time converted with the arrival airport time zone)',
  })
  arrivalAt: string;

  @ApiProperty({
    example: '2027-06-15',
    description: 'Departure date at the departure airport, YYYY-MM-DD',
  })
  departureDateLocal: string;

  @ApiProperty({
    enum: FlightStatus,
    enumName: 'FlightStatus',
    example: FlightStatus.Scheduled,
    description: 'Set by the server: a new flight is scheduled',
  })
  status: FlightStatus;

  @ApiProperty({
    example: '2026-11-18T10:00:00.000Z',
    description: 'When the flight was created, in UTC',
  })
  createdAt: string;

  @ApiProperty({
    example: '2026-11-18T10:00:00.000Z',
    description: 'When the flight was last changed, in UTC',
  })
  updatedAt: string;
}
