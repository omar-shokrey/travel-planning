import { ApiProperty } from '@nestjs/swagger';

/** FLT-02: one airport of the predefined list, as the API returns it. */
export class AirportResponseDto {
  @ApiProperty({
    description: "IATA code, which is the airport's id",
    example: 'CAI',
  })
  id: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ description: 'City id from the city list', example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'Cairo' })
  cityName: string;

  @ApiProperty({ description: 'ISO country code', example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 'Egypt' })
  countryName: string;

  @ApiProperty({
    description:
      'IANA time zone of the airport, used for local flight times (GEN-06)',
    example: 'Africa/Cairo',
  })
  timeZone: string;
}
