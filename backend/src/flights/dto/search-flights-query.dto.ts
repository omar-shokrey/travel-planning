import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  AIRPORT_CODE_PATTERN,
  FLIGHT_SEARCH_PASSENGERS_MAX,
  LOCAL_DATE_PATTERN,
} from '../flights.constants';

const trimmedUppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * FLT-11: a flight search, as a guest or a user sends it in the query string.
 * Only the four criteria of FLT-11 and the page: the round trip, the cabin
 * filter, price filters and sorting are later issues (FLT-12 to FLT-15),
 * which add their fields here. Any other parameter answers 400. The service
 * also checks that both airports are in the airports list and that they
 * differ, with the answers of FLT-03.
 */
export class SearchFlightsQueryDto extends PaginationQueryDto {
  /**
   * `skip` is computed by the server from `page` and `limit`, as in the shared
   * `PaginationQueryDto`. There it is a getter only, and class-transformer
   * assigns a sent `?skip=5` to a subclass, which throws (500). This setter
   * stores the sent value as an own field instead, so the global validation
   * pipe refuses it like any parameter the search does not have: 400 "property
   * skip should not exist", in the same answer as the other errors. The
   * validation pipe always runs (`forbidNonWhitelisted`), so a sent value never
   * reaches the service. The proper fix belongs in the shared DTO (a
   * shared-layer pull request).
   */
  override get skip(): number {
    return super.skip;
  }

  set skip(sent: unknown) {
    Object.defineProperty(this, 'skip', {
      value: sent,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

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
}
