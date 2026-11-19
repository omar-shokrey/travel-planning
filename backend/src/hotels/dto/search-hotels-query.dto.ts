import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  HOTEL_CITY_ID_MAX_LENGTH,
  HOTEL_SEARCH_GUESTS_MAX,
  HOTEL_SEARCH_ROOMS_MAX,
  ROOM_QUERY_MAX_NIGHTS,
} from '../hotels.constants';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/**
 * HTL-11: where, when and for how many. Give `cityId` or `countryCode`, not
 * both. The service also checks that check-in is not in the past and that the
 * stay is not too long.
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
}
