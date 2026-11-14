import { ApiProperty } from '@nestjs/swagger';

export class AirportResponseDto {
  @ApiProperty({
    description: 'IATA airport code',
    example: 'CAI',
  })
  code: string;

  @ApiProperty({
    description: 'Airport name',
    example: 'Cairo International Airport',
  })
  name: string;

  @ApiProperty({
    description: 'City name',
    example: 'Cairo',
  })
  city: string;

  @ApiProperty({
    description: 'Country name',
    example: 'Egypt',
  })
  country: string;

  @ApiProperty({
    description: 'IANA time zone',
    example: 'Africa/Cairo',
  })
  timeZone: string;
}
