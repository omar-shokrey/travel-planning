import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ACTIVITY_DESCRIPTION_MAX,
  ACTIVITY_NAME_MAX,
  CURRENCY_CODE_PATTERN,
} from '../itineraries.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A time of day such as 09:30, or empty for no time. */
const TIME_OR_EMPTY = /^(([01]\d|2[0-3]):[0-5]\d)?$/;

/** ITN-10: something to do on a day. A cost is optional and comes with its currency. */
export class CreateActivityDto {
  @ApiProperty({ example: 'Egyptian Museum', maxLength: ACTIVITY_NAME_MAX })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACTIVITY_NAME_MAX)
  name: string;

  @ApiPropertyOptional({
    description: 'Send an empty text to remove it',
    example: 'Two hours, book tickets online',
    maxLength: ACTIVITY_DESCRIPTION_MAX,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(ACTIVITY_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Time of day, HH:mm in 24-hour form. Send an empty text to remove it',
    example: '09:30',
  })
  @IsOptional()
  @Matches(TIME_OR_EMPTY, {
    message: 'time must be a time of day in the form HH:mm, such as 09:30',
  })
  time?: string;

  @ApiPropertyOptional({
    description:
      'Cost in whole minor units (cents), 0 or more. Sent together with currency',
    example: 20000,
    minimum: 0,
  })
  @ValidateIf(
    (dto: CreateActivityDto) =>
      dto.cost !== undefined || dto.currency !== undefined,
  )
  @IsInt({
    message:
      'cost must be a whole number of minor units, sent together with currency',
  })
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({
    description:
      'Currency of the cost, one of the supported currencies. Sent together with cost',
    example: 'EGP',
  })
  @ValidateIf(
    (dto: CreateActivityDto) =>
      dto.cost !== undefined || dto.currency !== undefined,
  )
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message:
      'currency must be a 3-letter currency code such as EGP, sent together with cost',
  })
  currency?: string;
}
