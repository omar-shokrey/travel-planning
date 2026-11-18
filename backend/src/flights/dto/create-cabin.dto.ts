import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsEnum, IsInt, Max, Min } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
} from '../flights.constants';
import { CabinClass } from '../models/cabin-class.enum';

/**
 * What an airline moderator sends to add a cabin category to a flight
 * (FLT-04). The seat counters (`bookedSeats`, `heldSeats`), the currency and
 * the cabin id are set by the server, so none of them is a field here:
 * sending them, or any other unknown field, answers 400.
 */
export class CreateCabinDto {
  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
    description:
      'Cabin category, from the fixed set. A flight has each category at most once. It cannot be changed later.',
  })
  @IsDefined({ message: 'cabin is required' })
  @IsEnum(CabinClass, {
    message: `cabin must be one of ${Object.values(CabinClass).join(', ')}`,
  })
  cabin: CabinClass;

  @ApiProperty({
    example: 180,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_SEATS_MAX,
    description: `Number of seats in this cabin: a whole number from 1 to ${CABIN_SEATS_MAX}.`,
  })
  @IsDefined({ message: 'totalSeats is required' })
  @IsInt({ message: 'totalSeats must be a whole number' })
  @Min(1, { message: 'totalSeats must be more than 0' })
  @Max(CABIN_SEATS_MAX, {
    message: `totalSeats must be at most ${CABIN_SEATS_MAX}`,
  })
  totalSeats: number;

  @ApiProperty({
    example: 25000,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_PRICE_MAX,
    description: `Price of one seat in minor units of ${PLATFORM_CURRENCY} (cents): 25000 is 250.00 ${PLATFORM_CURRENCY}. A whole number from 1 to ${CABIN_PRICE_MAX}.`,
  })
  @IsDefined({ message: 'price is required' })
  @IsInt({ message: 'price must be a whole number of minor units (cents)' })
  @Min(1, { message: 'price must be more than 0' })
  @Max(CABIN_PRICE_MAX, { message: `price must be at most ${CABIN_PRICE_MAX}` })
  price: number;

  @ApiProperty({
    example: 1,
    type: 'integer',
    minimum: 0,
    maximum: CABIN_FREE_BAGS_MAX,
    description: `Free checked bags per passenger: a whole number from 0 (no bag included) to ${CABIN_FREE_BAGS_MAX}.`,
  })
  @IsDefined({ message: 'freeBags is required' })
  @IsInt({ message: 'freeBags must be a whole number' })
  @Min(0, { message: 'freeBags must be 0 or more' })
  @Max(CABIN_FREE_BAGS_MAX, {
    message: `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
  })
  freeBags: number;

  @ApiProperty({
    example: 23,
    type: 'integer',
    minimum: 1,
    maximum: CABIN_BAG_WEIGHT_MAX_KG,
    description: `Maximum weight of one bag in whole kg, from 1 to ${CABIN_BAG_WEIGHT_MAX_KG}. Required even when freeBags is 0: an extra bag has the same maximum weight (FLT-08).`,
  })
  @IsDefined({ message: 'maxBagKg is required' })
  @IsInt({ message: 'maxBagKg must be a whole number of kg' })
  @Min(1, { message: 'maxBagKg must be at least 1' })
  @Max(CABIN_BAG_WEIGHT_MAX_KG, {
    message: `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
  })
  maxBagKg: number;
}
