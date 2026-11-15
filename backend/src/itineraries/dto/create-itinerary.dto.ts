import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  COUNTRY_CODE_PATTERN,
  DATE_ONLY_PATTERN,
  ITINERARY_TITLE_MAX,
} from '../itineraries.constants';

/**
 * ITN-01: what a user may send to create an itinerary. The owner, the
 * visibility and the day count are set by the server.
 */
export class CreateItineraryDto {
  @ApiProperty({
    example: 'Ten days in Egypt',
    maxLength: ITINERARY_TITLE_MAX,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(ITINERARY_TITLE_MAX)
  title: string;

  @ApiProperty({
    description:
      'Country codes from the country list, at least one, no repeats',
    type: [String],
    example: ['EG'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Matches(COUNTRY_CODE_PATTERN, {
    each: true,
    message: 'each country must be a 2-letter country code such as EG',
  })
  countries: string[];

  @ApiProperty({
    description: 'First day of the trip, a date without a time',
    example: '2026-12-20',
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'startDate must be a date in the form YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'startDate must be a real calendar date' },
  )
  startDate: string;
}
