import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightStatus } from '../models/flight-status.enum';
import { CabinResponseDto } from './cabin-response.dto';

/**
 * Public fields of a flight (FLT-03) with its cabins (FLT-04). Moments are
 * UTC; `departureDateLocal` is the local date, and the six local fields show
 * each time at its own airport (GEN-06).
 */
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
    example: '2027-01-15T08:00:00.000Z',
    description:
      'Departure moment in UTC (the local time converted with the departure airport time zone)',
  })
  departureAt: string;

  @ApiProperty({
    example: '2027-01-15T20:00:00.000Z',
    description:
      'Arrival moment in UTC (the local time converted with the arrival airport time zone)',
  })
  arrivalAt: string;

  @ApiProperty({
    example: '2027-01-15T10:00',
    description:
      'Departure time at the departure airport, in its own time zone (GEN-06), YYYY-MM-DDTHH:mm: the format of departureLocal when the flight is created',
  })
  departureLocal: string;

  @ApiProperty({
    example: 'Africa/Cairo',
    description: 'IANA time zone of the departure airport (GEN-06)',
  })
  departureTimeZone: string;

  @ApiProperty({
    example: '+02:00',
    description:
      'UTC offset of the departure airport at the departure moment (GEN-06), +HH:MM or -HH:MM; it follows daylight saving',
  })
  departureUtcOffset: string;

  @ApiProperty({
    example: '2027-01-15T15:00',
    description:
      'Arrival time at the arrival airport, in its own time zone (GEN-06), YYYY-MM-DDTHH:mm: the format of arrivalLocal when the flight is created',
  })
  arrivalLocal: string;

  @ApiProperty({
    example: 'America/New_York',
    description: 'IANA time zone of the arrival airport (GEN-06)',
  })
  arrivalTimeZone: string;

  @ApiProperty({
    example: '-05:00',
    description:
      'UTC offset of the arrival airport at the arrival moment (GEN-06), +HH:MM or -HH:MM; it follows daylight saving',
  })
  arrivalUtcOffset: string;

  @ApiProperty({
    example: '2027-01-15',
    description: 'Departure date at the departure airport, YYYY-MM-DD',
  })
  departureDateLocal: string;

  @ApiProperty({
    enum: FlightStatus,
    enumName: 'FlightStatus',
    example: FlightStatus.Scheduled,
    description:
      'Set by the server (FLT-30): scheduled until the departure time passes, then departed; a cancelled flight stays cancelled. A new flight is scheduled.',
  })
  status: FlightStatus;

  @ApiProperty({
    type: [CabinResponseDto],
    example: [
      {
        id: '6740f1c2a4b5c6d7e8f90789',
        cabin: CabinClass.Economy,
        totalSeats: 180,
        availableSeats: 180,
        price: 25000,
        currency: PLATFORM_CURRENCY,
        freeBags: 1,
        maxBagKg: 23,
      },
    ],
    description:
      'The cabin categories of the flight (FLT-04), each at most once. Empty until the moderator adds one.',
  })
  cabins: CabinResponseDto[];

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
