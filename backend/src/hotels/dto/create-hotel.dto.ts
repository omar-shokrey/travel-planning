import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HOTEL_ADDRESS_MAX_LENGTH,
  HOTEL_AMENITIES_MAX_COUNT,
  HOTEL_AMENITY_MAX_LENGTH,
  HOTEL_CITY_ID_MAX_LENGTH,
  HOTEL_DESCRIPTION_MAX_LENGTH,
  HOTEL_NAME_MAX_LENGTH,
  HOTEL_STAR_CLASS_MAX,
  HOTEL_STAR_CLASS_MIN,
} from '../hotels.constants';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Trims each amenity and removes duplicates, keeping the first, so "wifi" and
 * " wifi " are stored once. The 30-amenity limit is counted after that.
 * Anything that is not a text is left for the validators to reject.
 */
const trimAmenities = ({ value }: TransformFnParams): unknown =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((amenity: unknown) =>
            typeof amenity === 'string' ? amenity.trim() : amenity,
          ),
        ),
      ]
    : value;

export class CreateHotelDto {
  @ApiProperty({
    example: 'Cairo Garden Hotel',
    maxLength: HOTEL_NAME_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    example: '12 Nile Street',
    maxLength: HOTEL_ADDRESS_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_ADDRESS_MAX_LENGTH)
  addressLine: string;

  @ApiProperty({
    example: 'city_001',
    maxLength: HOTEL_CITY_ID_MAX_LENGTH,
    description: 'An existing city id from the reference data',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_CITY_ID_MAX_LENGTH)
  cityId: string;

  @ApiProperty({
    example: 'A quiet hotel close to the city centre.',
    maxLength: HOTEL_DESCRIPTION_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_DESCRIPTION_MAX_LENGTH)
  description: string;

  @ApiProperty({
    example: 4,
    minimum: HOTEL_STAR_CLASS_MIN,
    maximum: HOTEL_STAR_CLASS_MAX,
  })
  @IsInt()
  @Min(HOTEL_STAR_CLASS_MIN)
  @Max(HOTEL_STAR_CLASS_MAX)
  starClass: number;

  @ApiProperty({
    example: ['wifi', 'pool'],
    type: [String],
    maxItems: HOTEL_AMENITIES_MAX_COUNT,
    description: `Up to ${HOTEL_AMENITIES_MAX_COUNT} amenities of at most ${HOTEL_AMENITY_MAX_LENGTH} characters. They are trimmed and duplicates are removed.`,
  })
  @Transform(trimAmenities)
  @IsArray()
  @ArrayMaxSize(HOTEL_AMENITIES_MAX_COUNT)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(HOTEL_AMENITY_MAX_LENGTH, { each: true })
  amenities: string[];
}
