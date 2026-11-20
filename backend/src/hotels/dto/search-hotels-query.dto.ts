import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  HOTEL_CITY_ID_MAX_LENGTH,
  HOTEL_RATING_MAX,
  HOTEL_RATING_MIN,
  HOTEL_SEARCH_GUESTS_MAX,
  HOTEL_SEARCH_ROOMS_MAX,
  HOTEL_SEARCH_SORT_ORDERS,
  HOTEL_SEARCH_SORTS,
  type HotelSearchSort,
  type HotelSearchSortOrder,
  ROOM_PRICE_MAX,
  ROOM_QUERY_MAX_NIGHTS,
} from '../hotels.constants';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/**
 * A price from the query string as a number, only when it is written as a
 * whole number. Anything else (`''`, `12.5`, `1e3`, `abc`, a repeated
 * parameter) stays as sent, so `@IsInt` refuses it; `@Type(() => Number)`
 * would turn `''` into 0 and accept it. The same rule as the flight search.
 */
const wholeNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;

/**
 * A rating from the query string as a number, only when it is written as a
 * plain decimal (`4`, `4.5`, `-1`). Anything else (`''`, `abc`, `4.`, `1e0`)
 * stays as sent, so `@IsNumber` refuses it.
 */
const decimalNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
    ? Number(value.trim())
    : value;

/**
 * No `example` on the filters: Swagger UI's "Try it out" sends every example,
 * which would narrow a plain search. The example is in the text.
 */
const priceDescription = (
  bound: 'Lowest' | 'Highest',
  exampleCents: number,
): string =>
  `${bound} price per night, inclusive, in minor units of ${PLATFORM_CURRENCY} (cents): a whole number from 0 to ${ROOM_PRICE_MAX}. The price of a hotel is its cheapest room that is free for the stay, the \`lowestPricePerNight\` of the result; a hotel is listed only when that price is inside the range. minPrice above maxPrice answers 400; equal values are valid. For example, ${exampleCents} is ${(exampleCents / 100).toFixed(2)} ${PLATFORM_CURRENCY}.`;

/**
 * HTL-11: where, when and for how many. Give `cityId` or `countryCode`, not
 * both. HTL-12 adds a price range, a minimum rating and the order. The
 * service also checks that check-in is not in the past, that the stay is not
 * too long and that minPrice is not above maxPrice.
 */
export class SearchHotelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'City id from the reference data. Give this or countryCode.',
    example: 'cairo',
    maxLength: HOTEL_CITY_ID_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(HOTEL_CITY_ID_MAX_LENGTH)
  cityId?: string;

  @ApiPropertyOptional({
    description: 'Two-letter country code. Give this or cityId.',
    example: 'EG',
  })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be two capital letters, for example EG',
  })
  countryCode?: string;

  @ApiProperty({
    description:
      'Check-in date (the first night), YYYY-MM-DD. Today (UTC) or later.',
    example: '2026-12-20',
  })
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn: string;

  @ApiProperty({
    description: `Check-out date (the day after the last night), YYYY-MM-DD. After checkIn, at most ${ROOM_QUERY_MAX_NIGHTS} nights later.`,
    example: '2026-12-23',
  })
  @IsDateOnly('checkOut')
  checkOut: string;

  @ApiProperty({
    description: 'Number of guests',
    minimum: 1,
    maximum: HOTEL_SEARCH_GUESTS_MAX,
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_GUESTS_MAX)
  guests: number;

  @ApiPropertyOptional({
    description: 'Number of rooms',
    minimum: 1,
    maximum: HOTEL_SEARCH_ROOMS_MAX,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_ROOMS_MAX)
  rooms: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: ROOM_PRICE_MAX,
    description: priceDescription('Lowest', 10000),
  })
  @IsOptional()
  @Transform(wholeNumber)
  @IsInt({ message: 'minPrice must be a whole number of minor units (cents)' })
  @Min(0, { message: 'minPrice must be 0 or more' })
  @Max(ROOM_PRICE_MAX, {
    message: `minPrice must be at most ${ROOM_PRICE_MAX}`,
  })
  minPrice?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: ROOM_PRICE_MAX,
    description: priceDescription('Highest', 50000),
  })
  @IsOptional()
  @Transform(wholeNumber)
  @IsInt({ message: 'maxPrice must be a whole number of minor units (cents)' })
  @Min(0, { message: 'maxPrice must be 0 or more' })
  @Max(ROOM_PRICE_MAX, {
    message: `maxPrice must be at most ${ROOM_PRICE_MAX}`,
  })
  maxPrice?: number;

  @ApiPropertyOptional({
    type: 'number',
    minimum: HOTEL_RATING_MIN,
    maximum: HOTEL_RATING_MAX,
    description: `Lowest average rating, inclusive: a number from ${HOTEL_RATING_MIN} to ${HOTEL_RATING_MAX}, decimals allowed (for example 4.5). A hotel with no rating yet is left out when this is set; without it, unrated hotels are listed too.`,
  })
  @IsOptional()
  @Transform(decimalNumber)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    {
      message: `minRating must be a number from ${HOTEL_RATING_MIN} to ${HOTEL_RATING_MAX}`,
    },
  )
  @Min(HOTEL_RATING_MIN, {
    message: `minRating must be at least ${HOTEL_RATING_MIN}`,
  })
  @Max(HOTEL_RATING_MAX, {
    message: `minRating must be at most ${HOTEL_RATING_MAX}`,
  })
  minRating?: number;

  @ApiPropertyOptional({
    enum: HOTEL_SEARCH_SORTS,
    default: 'name',
    example: 'name',
    description:
      'The order of the results: `name` (the default, the order of HTL-11), `price` (the lowest price per night for the stay) or `rating` (the average rating; hotels with no rating yet always come last). Hotels that are equal on it keep the name order, so pages never repeat or skip a hotel.',
  })
  @IsOptional()
  @IsIn(HOTEL_SEARCH_SORTS, {
    message: `sortBy must be one of: ${HOTEL_SEARCH_SORTS.join(', ')}`,
  })
  sortBy: HotelSearchSort = 'name';

  @ApiPropertyOptional({
    enum: HOTEL_SEARCH_SORT_ORDERS,
    description:
      'The direction of `sortBy`. When it is not sent: `asc` for `name` and `price` (A to Z, cheapest first) and `desc` for `rating` (best first). A sent value always wins.',
  })
  @IsOptional()
  @IsIn(HOTEL_SEARCH_SORT_ORDERS, {
    message: `sortOrder must be one of: ${HOTEL_SEARCH_SORT_ORDERS.join(', ')}`,
  })
  sortOrder?: HotelSearchSortOrder;
}
