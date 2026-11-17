import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  COUNTRY_CODE_PATTERN,
  ITINERARY_MAX_DAYS,
} from '../itineraries.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** ITN-21: search and filters for public itineraries, with the usual paging. */
export class SearchPublicItinerariesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Keyword, in any letter case: matches part of the title, a country (code or name) or a city name of any day',
    example: 'cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Only itineraries with at least this many days',
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_MAX_DAYS)
  minDays?: number;

  @ApiPropertyOptional({
    description: 'Only itineraries with at most this many days',
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_MAX_DAYS)
  maxDays?: number;

  @ApiPropertyOptional({
    description: 'Only itineraries in this country (country code)',
    example: 'EG',
  })
  @IsOptional()
  @Matches(COUNTRY_CODE_PATTERN, {
    message: 'country must be a 2-letter country code such as EG',
  })
  country?: string;

  @ApiPropertyOptional({
    description: 'Only itineraries with a day in this city (city id)',
    example: 'cairo',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;
}
