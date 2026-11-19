import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, Max, Min } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { EXTRA_BAG_PRICE_MAX, MAX_EXTRA_BAGS_MAX } from '../flights.constants';

/** Said in both fields: an extra bag weighs at most what a free bag of the cabin weighs. */
const WEIGHT_RULE =
  "Each extra bag has the same maximum weight as the free bags of the passenger's cabin: the cabin's `maxBagKg` (FLT-04). No weight is set here.";

/**
 * The extra-bag rule of an airline, as its airline moderator sends it
 * (FLT-08). Both fields are required: the PUT replaces the rule. The maximum
 * weight of an extra bag is not a field: it is the `maxBagKg` of the cabin
 * the passenger flies in. The free baggage allowance (`freeBags`,
 * `maxBagKg`) stays on each cabin (FLT-04), and the cancellation tiers have
 * their own route (FLT-09), so neither is accepted here: sending them, or
 * any other unknown field, answers 400.
 */
export class UpdateBaggagePolicyDto {
  @ApiProperty({
    example: 5000,
    type: 'integer',
    minimum: 1,
    maximum: EXTRA_BAG_PRICE_MAX,
    description: `Price of one extra bag, per passenger and per bag, in minor units of ${PLATFORM_CURRENCY} (cents): 5000 is 50.00 ${PLATFORM_CURRENCY}. A whole number from 1 to ${EXTRA_BAG_PRICE_MAX}. ${WEIGHT_RULE}`,
  })
  @IsDefined({ message: 'extraBagPrice is required' })
  @IsInt({
    message: 'extraBagPrice must be a whole number of minor units (cents)',
  })
  @Min(1, { message: 'extraBagPrice must be more than 0' })
  @Max(EXTRA_BAG_PRICE_MAX, {
    message: `extraBagPrice must be at most ${EXTRA_BAG_PRICE_MAX}`,
  })
  extraBagPrice: number;

  @ApiProperty({
    example: 2,
    type: 'integer',
    minimum: 0,
    maximum: MAX_EXTRA_BAGS_MAX,
    description: `The most extra bags one passenger may add to a booking: a whole number from 0 to ${MAX_EXTRA_BAGS_MAX}. 0 means the airline sells no extra bag (the price is still stored). ${WEIGHT_RULE}`,
  })
  @IsDefined({ message: 'maxExtraBags is required' })
  @IsInt({ message: 'maxExtraBags must be a whole number' })
  @Min(0, { message: 'maxExtraBags must be 0 or more' })
  @Max(MAX_EXTRA_BAGS_MAX, {
    message: `maxExtraBags must be at most ${MAX_EXTRA_BAGS_MAX}`,
  })
  maxExtraBags: number;
}
