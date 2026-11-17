import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { HOTEL_CANCELLATION_TIERS_MAX_COUNT } from '../hotels.constants';
import { TIME_OF_DAY_PATTERN } from '../models/hotel-policy.schema';

/** One cancellation tier as the hotel moderator sends it (HTL-10). */
export class CancellationTierDto {
  @ApiProperty({
    description:
      'Threshold in whole days before check-in. Each tier of a hotel has a different threshold.',
    example: 7,
    minimum: 0,
  })
  @IsInt({ message: 'daysBefore must be a whole number' })
  @Min(0, { message: 'daysBefore must be 0 or more' })
  daysBefore: number;

  @ApiProperty({
    description:
      'Refund in percent of the reservation total, for a cancellation at least `daysBefore` days before check-in',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsInt({ message: 'refundPercent must be a whole number' })
  @Min(0, { message: 'refundPercent must be between 0 and 100' })
  @Max(100, { message: 'refundPercent must be between 0 and 100' })
  refundPercent: number;
}

/**
 * What a hotel moderator may send to set the hotel's policies (HTL-09,
 * HTL-10). `PUT` replaces the policies as a whole, so every field is required.
 */
export class SetHotelPoliciesDto {
  @ApiProperty({
    description:
      'Standard check-in time, local to the hotel, on the 24-hour clock (HH:mm)',
    example: '14:00',
    pattern: TIME_OF_DAY_PATTERN.source,
  })
  @IsString({ message: 'checkInTime must be text' })
  @Matches(TIME_OF_DAY_PATTERN, {
    message: 'checkInTime must be a time such as 14:00 (HH:mm, 24-hour clock)',
  })
  checkInTime: string;

  @ApiProperty({
    description:
      'Standard check-out time, local to the hotel, on the 24-hour clock (HH:mm)',
    example: '12:00',
    pattern: TIME_OF_DAY_PATTERN.source,
  })
  @IsString({ message: 'checkOutTime must be text' })
  @Matches(TIME_OF_DAY_PATTERN, {
    message: 'checkOutTime must be a time such as 12:00 (HH:mm, 24-hour clock)',
  })
  checkOutTime: string;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'The cancellation tiers (HTL-10). A cancellation is refunded by the tier with the highest `daysBefore` that does not exceed the days remaining before check-in; if no tier applies, the refund is 0%. Send an empty list for "no refund".',
    example: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ],
    maxItems: HOTEL_CANCELLATION_TIERS_MAX_COUNT,
  })
  @IsArray({ message: 'cancellationTiers must be a list' })
  @ArrayMaxSize(HOTEL_CANCELLATION_TIERS_MAX_COUNT, {
    message: `cancellationTiers must have at most ${HOTEL_CANCELLATION_TIERS_MAX_COUNT} tiers`,
  })
  @ArrayUnique((tier: CancellationTierDto) => tier?.daysBefore, {
    message: 'Each cancellation tier must have a different daysBefore',
  })
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];
}
