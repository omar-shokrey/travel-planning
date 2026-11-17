import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  HOTEL_CITY_ID_MAX_LENGTH,
  HOTEL_SEARCH_MAX_GUESTS,
  HOTEL_SEARCH_MAX_ROOMS,
} from '../hotels.constants';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/** Trims a text. A blank text counts as not sent. */
const trimToUndefined = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** Trims and upper-cases a country code. */
const toCountryCode = (params: TransformFnParams): unknown => {
  const value = trimToUndefined(params);
  return typeof value === 'string' ? value.toUpperCase() : value;
};

const ONE_LOCATION_MESSAGE = 'Send exactly one of cityId or countryCode';

/**
 * HTL-11: `GET /api/hotels/search?cityId=cairo&checkIn=...&checkOut=...&guests=2&rooms=1`.
 * The destination is a city or a country, never both.
 */
export class SearchHotelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'City id from the reference data. Send this or `countryCode`, not both.',
    example: 'cairo',
    maxLength: HOTEL_CITY_ID_MAX_LENGTH,
  })
  // Checked when sent, and also when neither destination is sent, so that
  // case gets the message below.
  @ValidateIf(
    (query: SearchHotelsQueryDto) =>
      query.cityId !== undefined || query.countryCode === undefined,
  )
  @Transform(trimToUndefined)
  @ValidateBy({
    name: 'oneLocation',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean =>
        value !== undefined &&
        (args?.object as SearchHotelsQueryDto | undefined)?.countryCode ===
          undefined,
      defaultMessage: () => ONE_LOCATION_MESSAGE,
    },
  })
  @IsString()
  @MaxLength(HOTEL_CITY_ID_MAX_LENGTH)
  cityId?: string;

  @ApiPropertyOptional({
    description:
      'Two-letter country code (ISO 3166-1 alpha-2), in any letter case. Send this or `cityId`, not both.',
    example: 'EG',
  })
  @IsOptional()
  @Transform(toCountryCode)
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter country code',
  })
  countryCode?: string;

  @ApiProperty({
    description:
      'Check-in date (the first night) in YYYY-MM-DD format. Cannot be in the past (UTC).',
    example: '2026-12-10',
  })
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn: string;

  @ApiProperty({
    description:
      'Check-out date in YYYY-MM-DD format. Must be after the check-in date; at most 366 nights later.',
    example: '2026-12-13',
  })
  @IsDateOnly('checkOut')
  checkOut: string;

  @ApiProperty({
    description: `Number of guests, 1 to ${HOTEL_SEARCH_MAX_GUESTS}`,
    example: 2,
    minimum: 1,
    maximum: HOTEL_SEARCH_MAX_GUESTS,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_MAX_GUESTS)
  guests: number;

  @ApiPropertyOptional({
    description: `Number of rooms, 1 to ${HOTEL_SEARCH_MAX_ROOMS}`,
    example: 1,
    minimum: 1,
    maximum: HOTEL_SEARCH_MAX_ROOMS,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_SEARCH_MAX_ROOMS)
  rooms: number = 1;
}
