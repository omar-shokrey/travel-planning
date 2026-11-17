import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsInt,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { CANCELLATION_TIERS_MAX_COUNT } from '../flights.constants';

/** One cancellation tier as the airline moderator sends it (FLT-09). */
export class CancellationTierDto {
  @ApiProperty({
    description:
      'Threshold in whole days before departure. Each tier of an airline has a different threshold.',
    example: 7,
    minimum: 0,
  })
  @IsInt({ message: 'daysBefore must be a whole number' })
  @Min(0, { message: 'daysBefore must be 0 or more' })
  daysBefore: number;

  @ApiProperty({
    description:
      'Refund in percent of the booking total, for a cancellation at least `daysBefore` days before departure',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsInt({ message: 'refundPercent must be a whole number' })
  @Min(0, { message: 'refundPercent must be between 0 and 100' })
  @Max(100, { message: 'refundPercent must be between 0 and 100' })
  refundPercent: number;
}

/** The tiers sent, or `[]` when `tiers` is not a list: IsArray reports that case alone. */
const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : [];

const isTierObject = (tier: unknown): boolean =>
  typeof tier === 'object' && tier !== null && !Array.isArray(tier);

/** The whole-number thresholds that appear more than once. A missing one is reported on its tier. */
function repeatedThresholds(value: unknown): number[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  for (const tier of listOf(value)) {
    const days = isTierObject(tier)
      ? (tier as Partial<CancellationTierDto>).daysBefore
      : undefined;
    if (typeof days !== 'number') {
      continue;
    }
    if (seen.has(days)) {
      repeated.add(days);
    }
    seen.add(days);
  }
  return [...repeated];
}

/**
 * Each tier is an object. Without this, `ValidateNested` walks into a tier
 * sent as a list instead of refusing it.
 */
const TiersAreObjects = () =>
  ValidateBy({
    name: 'tiersAreObjects',
    validator: {
      validate: (value: unknown) => listOf(value).every(isTierObject),
      defaultMessage: () => 'Each tier must be an object',
    },
  });

const AtMostTiers = (max: number) =>
  ValidateBy({
    name: 'atMostTiers',
    validator: {
      validate: (value: unknown) => listOf(value).length <= max,
      defaultMessage: () => `tiers must have at most ${max} tiers`,
    },
  });

const UniqueThresholds = () =>
  ValidateBy({
    name: 'uniqueThresholds',
    validator: {
      validate: (value: unknown) => repeatedThresholds(value).length === 0,
      defaultMessage: ({ value }: ValidationArguments) =>
        `Each tier must have a different daysBefore: ${repeatedThresholds(value).join(', ')} appears more than once`,
    },
  });

/**
 * What an airline moderator sends to set the cancellation policy (FLT-09).
 * `PUT` replaces the whole list, so `tiers` is required; an empty list means
 * no refund at all.
 */
export class UpdateCancellationPolicyDto {
  @ApiProperty({
    type: [CancellationTierDto],
    description: `The cancellation tiers, in any order; they are stored with the highest \`daysBefore\` first. A cancellation is refunded by the tier with the highest \`daysBefore\` that does not exceed the days remaining before departure; if no tier applies, the refund is 0%. Send an empty list for "no refund". At most ${CANCELLATION_TIERS_MAX_COUNT} tiers.`,
    example: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 1, refundPercent: 25 },
    ],
    maxItems: CANCELLATION_TIERS_MAX_COUNT,
  })
  @IsDefined({ message: 'tiers is required (send [] for no refund)' })
  @IsArray({ message: 'tiers must be a list' })
  @AtMostTiers(CANCELLATION_TIERS_MAX_COUNT)
  @TiersAreObjects()
  @UniqueThresholds()
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers: CancellationTierDto[];
}
