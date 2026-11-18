import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { ROOM_PRICE_MAX } from '../hotels.constants';

/**
 * Validate a field whenever it was sent. `@IsOptional()` would also skip
 * `null`, and a room has no field that may be empty.
 */
const whenSent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * What a hotel moderator may change in a room (HTL-05): beds, occupancy and
 * price. A field that is left out keeps its value. The room number and type
 * are not part of HTL-05, so they cannot be sent here.
 */
export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @ValidateIf(whenSent)
  @IsInt({ message: 'beds must be a whole number' })
  @Min(1, { message: 'beds must be at least 1' })
  beds?: number;

  @ApiPropertyOptional({ example: 3, minimum: 1 })
  @ValidateIf(whenSent)
  @IsInt({ message: 'maxOccupancy must be a whole number' })
  @Min(1, { message: 'maxOccupancy must be at least 1' })
  maxOccupancy?: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: 1,
    maximum: ROOM_PRICE_MAX,
    description: `Price per night in minor units, at most ${ROOM_PRICE_MAX}. It applies to new reservations only.`,
  })
  @ValidateIf(whenSent)
  @IsInt({
    message: 'pricePerNight must be a whole number of minor units',
  })
  @Min(1, { message: 'pricePerNight must be more than 0' })
  @Max(ROOM_PRICE_MAX, {
    message: `pricePerNight must be at most ${ROOM_PRICE_MAX}`,
  })
  pricePerNight?: number;
}
