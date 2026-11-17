import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CURRENCY_CODE_PATTERN,
  TRANSPORT_MODE_MAX,
} from '../itineraries.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** ITN-16: the cost of travelling between two cities, booked on one day of the itinerary. */
export class CreateTransportCostDto {
  @ApiProperty({
    description: 'Id of the day of this itinerary the trip is on',
    example: '6741c0ffee0ddba11ad0d0d0',
  })
  @IsMongoId({
    message: 'dayId must be a valid id (24 hexadecimal characters)',
  })
  dayId: string;

  @ApiProperty({
    description: 'How you travel, for example train, bus or flight',
    example: 'train',
    maxLength: TRANSPORT_MODE_MAX,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TRANSPORT_MODE_MAX)
  mode: string;

  @ApiProperty({ description: 'City id from the city list', example: 'cairo' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  fromCityId: string;

  @ApiProperty({
    description: 'City id from the city list, not the same as fromCityId',
    example: 'luxor',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  toCityId: string;

  @ApiProperty({
    description: 'Whole minor units (cents), 0 or more',
    example: 90000,
    minimum: 0,
  })
  @IsInt({ message: 'amount must be a whole number of minor units' })
  @Min(0)
  amount: number;

  @ApiProperty({
    description: 'Currency of the amount, one of the supported currencies',
    example: 'EGP',
  })
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'currency must be a 3-letter currency code such as EGP',
  })
  currency: string;
}
