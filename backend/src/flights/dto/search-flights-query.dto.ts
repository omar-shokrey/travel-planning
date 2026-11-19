import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  AIRPORT_CODE_PATTERN,
  CABIN_PRICE_MAX,
  FLIGHT_SEARCH_PASSENGERS_MAX,
  FLIGHT_SEARCH_SORTS,
  type FlightSearchSort,
  LOCAL_DATE_PATTERN,
  SORT_ORDERS,
  type SortOrder,
} from '../flights.constants';

const trimmedUppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A price from the query string as a number, only when it is written as a
 * whole number. Anything else (`''`, `12.5`, `1e3`, `abc`, a repeated
 * parameter) stays as sent, so `@IsInt` refuses it; `@Type(() => Number)`
 * would turn `''` into 0 and accept it.
 */
const wholeNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;

/**
 * No `example` on the price range: Swagger UI's "Try it out" sends every
 * example, which would narrow a plain search. The example is in the text.
 */
const priceDescription = (
  bound: 'Lowest' | 'Highest',
  exampleCents: number,
): string =>
  `${bound} price of one seat, inclusive, in minor units of ${PLATFORM_CURRENCY} (cents): a whole number from 0 to ${CABIN_PRICE_MAX}. A flight is listed when one of its cabins fits the passengers and is inside the price range; only those cabins are returned. minPrice above maxPrice answers 400; equal values are valid. For example, ${exampleCents} is ${(exampleCents / 100).toFixed(2)} ${PLATFORM_CURRENCY}.`;

/**
 * FLT-11: a flight search, as a guest or a user sends it in the query string:
 * the four criteria of FLT-11, the price range and the order of FLT-15, and
 * the page. The round trip and the cabin filter (FLT-12) add their fields
 * here. Any other parameter answers 400. The service also checks that both
 * airports are in the airports list and that they differ (the answers of
 * FLT-03), and that minPrice is not above maxPrice.
 */
export class SearchFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'CAI',
    description:
      'IATA code of the departure airport, from GET /api/airports (FLT-02). Outer spaces are removed and letters are uppercased, so " cai " is CAI.',
  })
  @Transform(trimmedUppercase)
  @IsDefined({ message: 'departureAirport is required' })
  @IsString({ message: 'departureAirport must be a string' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'departureAirport must be a 3-letter IATA airport code',
  })
  departureAirport: string;

  @ApiProperty({
    example: 'JFK',
    description:
      'IATA code of the arrival airport, from GET /api/airports (FLT-02). Must differ from the departure airport. Trimmed and uppercased.',
  })
  @Transform(trimmedUppercase)
  @IsDefined({ message: 'arrivalAirport is required' })
  @IsString({ message: 'arrivalAirport must be a string' })
  @Matches(AIRPORT_CODE_PATTERN, {
    message: 'arrivalAirport must be a 3-letter IATA airport code',
  })
  arrivalAirport: string;

  @ApiProperty({
    example: '2027-06-15',
    description:
      'Departure date at the departure airport (its local date, not the UTC date), YYYY-MM-DD. A date in the past or far ahead is not an error: it finds no flight.',
  })
  @Transform(trimmed)
  @IsDefined({ message: 'departureDate is required' })
  @IsString({ message: 'departureDate must be a string' })
  @Matches(LOCAL_DATE_PATTERN, {
    message: 'departureDate must be a date YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'departureDate must be a real calendar date' },
  )
  departureDate: string;

  @ApiProperty({
    example: 2,
    type: 'integer',
    minimum: 1,
    maximum: FLIGHT_SEARCH_PASSENGERS_MAX,
    description: `Number of passengers who need a seat: a whole number from 1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}. A flight is listed when one of its cabins has at least this many seats left (seats minus those booked or held). Infants under 2 occupy no seat and are not counted.`,
  })
  @IsDefined({ message: 'passengers is required' })
  @Type(() => Number)
  @IsInt({ message: 'passengers must be a whole number' })
  @Min(1, { message: 'passengers must be at least 1' })
  @Max(FLIGHT_SEARCH_PASSENGERS_MAX, {
    message: `passengers must be at most ${FLIGHT_SEARCH_PASSENGERS_MAX}`,
  })
  passengers: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: CABIN_PRICE_MAX,
    description: priceDescription('Lowest', 10000),
  })
  @IsOptional()
  @Transform(wholeNumber)
  @IsInt({ message: 'minPrice must be a whole number of minor units (cents)' })
  @Min(0, { message: 'minPrice must be 0 or more' })
  @Max(CABIN_PRICE_MAX, {
    message: `minPrice must be at most ${CABIN_PRICE_MAX}`,
  })
  minPrice?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: CABIN_PRICE_MAX,
    description: priceDescription('Highest', 50000),
  })
  @IsOptional()
  @Transform(wholeNumber)
  @IsInt({ message: 'maxPrice must be a whole number of minor units (cents)' })
  @Min(0, { message: 'maxPrice must be 0 or more' })
  @Max(CABIN_PRICE_MAX, {
    message: `maxPrice must be at most ${CABIN_PRICE_MAX}`,
  })
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: FLIGHT_SEARCH_SORTS,
    default: 'departureTime',
    example: 'departureTime',
    description:
      'The order of the results: `price` (the price of one seat in the cheapest cabin listed for the flight), `duration` (arrival minus departure) or `departureTime` (the default). Flights that are equal on it keep a fixed order (by id), so pages never repeat or skip a flight.',
  })
  @IsOptional()
  @IsIn(FLIGHT_SEARCH_SORTS, {
    message: `sortBy must be one of: ${FLIGHT_SEARCH_SORTS.join(', ')}`,
  })
  sortBy: FlightSearchSort = 'departureTime';

  @ApiPropertyOptional({
    enum: SORT_ORDERS,
    default: 'asc',
    example: 'asc',
    description:
      'The direction of `sortBy`: `asc` (cheapest, shortest or earliest first, the default) or `desc`.',
  })
  @IsOptional()
  @IsIn(SORT_ORDERS, {
    message: `sortOrder must be one of: ${SORT_ORDERS.join(', ')}`,
  })
  sortOrder: SortOrder = 'asc';
}
