import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { SearchFlightsQueryDto } from '../../flights/dto/search-flights-query.dto';
import {
  AIRPORT_CODE_PATTERN,
  LOCAL_DATE_PATTERN,
} from '../../flights/flights.constants';
import { ItineraryTripType } from '../enums/itinerary-trip-type.enum';

const trimmedUppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ITN-26: a flight search from an itinerary. The passengers, cabin, price
 * range, order and page are those of flight search (FLT-11, FLT-12, FLT-15),
 * inherited with their rules. The destination is not here: it is every
 * airport in the city of the itinerary's first day. The origin is the user's,
 * and the dates default to the itinerary's.
 *
 * No `example` on the optional fields: Swagger UI's "Try it out" would send
 * it and replace the itinerary's dates with an example.
 */
export class ItineraryFlightsQueryDto extends OmitType(SearchFlightsQueryDto, [
  'departureAirport',
  'arrivalAirport',
  'departureDate',
  'returnDate',
] as const) {
  @ApiProperty({
    example: 'CAI',
    description:
      "IATA code of the airport you fly from, from GET /api/airports (FLT-02). It must not be in the city of the itinerary's first day. Trimmed and uppercased.",
  })
  @Transform(trimmedUppercase)
  @IsDefined({ message: 'originAirport is required' })
  @IsString({ message: 'originAirport must be a string' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'originAirport must be a 3-letter IATA airport code',
  })
  originAirport: string;

  @ApiPropertyOptional({
    enum: ItineraryTripType,
    enumName: 'ItineraryTripType',
    default: ItineraryTripType.RoundTrip,
    description:
      '`round_trip` (the default): flights to the first city and back. `one_way`: only flights to the first city.',
  })
  @IsOptional()
  @IsEnum(ItineraryTripType, {
    message: `tripType must be one of: ${Object.values(ItineraryTripType).join(', ')}`,
  })
  tripType: ItineraryTripType = ItineraryTripType.RoundTrip;

  @ApiPropertyOptional({
    description:
      "Outbound date, the local date at the origin airport, YYYY-MM-DD. Leave it out for the itinerary's start date (ITN-26).",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'departureDate must be a string' })
  @Matches(LOCAL_DATE_PATTERN, {
    message: 'departureDate must be a date YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'departureDate must be a real calendar date' },
  )
  departureDate?: string;

  @ApiPropertyOptional({
    description:
      "Round trip only: the return date, the local date at the first city's airport, YYYY-MM-DD, on or after the outbound date. Leave it out for the date of the itinerary's last day (ITN-26). Sent with tripType one_way it is 400.",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'returnDate must be a string' })
  @Matches(LOCAL_DATE_PATTERN, {
    message: 'returnDate must be a date YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'returnDate must be a real calendar date' },
  )
  returnDate?: string;
}
