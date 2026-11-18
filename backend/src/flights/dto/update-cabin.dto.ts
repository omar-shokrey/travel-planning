import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
} from '../flights.constants';

/**
 * Validate a field whenever it was sent. `@IsOptional()` would also skip
 * `null`, and no cabin field may be empty.
 */
const whenSent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * What an airline moderator may change in a cabin (FLT-04, FLT-05): the seat
 * count, the price and the baggage allowance. A field that is left out keeps
 * its value; at least one must be sent (the service answers 400 otherwise).
 * The cabin class cannot be changed, so `cabin` is not a field here: sending
 * it answers 400. Not `PartialType(CreateCabinDto)`: that would add
 * `@IsOptional()`, which lets `null` through.
 */
export class UpdateCabinDto {
  @ApiPropertyOptional({
    example: 200,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_SEATS_MAX,
    description: `New number of seats: a whole number from 1 to ${CABIN_SEATS_MAX}, and not below the seats already booked or held.`,
  })
  @ValidateIf(whenSent)
  @IsInt({ message: 'totalSeats must be a whole number' })
  @Min(1, { message: 'totalSeats must be more than 0' })
  @Max(CABIN_SEATS_MAX, {
    message: `totalSeats must be at most ${CABIN_SEATS_MAX}`,
  })
  totalSeats?: number;

  @ApiPropertyOptional({
    example: 27500,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_PRICE_MAX,
    description: `New price of one seat in minor units of USD (cents), from 1 to ${CABIN_PRICE_MAX}. It applies to new bookings only.`,
  })
  @ValidateIf(whenSent)
  @IsInt({ message: 'price must be a whole number of minor units (cents)' })
  @Min(1, { message: 'price must be more than 0' })
  @Max(CABIN_PRICE_MAX, { message: `price must be at most ${CABIN_PRICE_MAX}` })
  price?: number;

  @ApiPropertyOptional({
    example: 2,
    type: 'integer',
    minimum: 0,
    maximum: CABIN_FREE_BAGS_MAX,
    description: `New number of free checked bags per passenger, from 0 to ${CABIN_FREE_BAGS_MAX}.`,
  })
  @ValidateIf(whenSent)
  @IsInt({ message: 'freeBags must be a whole number' })
  @Min(0, { message: 'freeBags must be 0 or more' })
  @Max(CABIN_FREE_BAGS_MAX, {
    message: `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
  })
  freeBags?: number;

  @ApiPropertyOptional({
    example: 32,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_BAG_WEIGHT_MAX_KG,
    description: `New maximum weight of one bag in whole kg, from 1 to ${CABIN_BAG_WEIGHT_MAX_KG}.`,
  })
  @ValidateIf(whenSent)
  @IsInt({ message: 'maxBagKg must be a whole number of kg' })
  @Min(1, { message: 'maxBagKg must be at least 1' })
  @Max(CABIN_BAG_WEIGHT_MAX_KG, {
    message: `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
  })
  maxBagKg?: number;
}
