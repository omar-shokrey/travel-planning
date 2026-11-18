import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateFlightDto {
  @ApiProperty({
    example: 'MS123',
    description: 'Flight number, 2 to 10 uppercase letters or digits.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9]{2,10}$/)
  flightNumber: string;

  @ApiProperty({
    example: 'CAI',
    description: 'Departure airport IATA code.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/)
  departureAirport: string;

  @ApiProperty({
    example: 'JFK',
    description: 'Arrival airport IATA code.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport: string;

  @ApiProperty({
    example: '2027-06-15T14:30',
    description:
      'Departure date-time in the departure airport local time. No timezone offset or Z is allowed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
  departureLocal: string;

  @ApiProperty({
    example: '2027-06-15T18:30',
    description:
      'Arrival date-time in the arrival airport local time. No timezone offset or Z is allowed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
  arrivalLocal: string;
}
