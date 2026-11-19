import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { EXTRA_BAG_PRICE_MAX, MAX_EXTRA_BAGS_MAX } from '../flights.constants';

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

/**
 * One step of an airline's cancellation policy (FLT-09): a booking cancelled
 * at least `daysBefore` days before departure gets `refundPercent` back.
 */
@Schema({ _id: false })
export class CancellationTier {
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: isWholeNumber,
      message: 'daysBefore must be a whole number',
    },
  })
  daysBefore: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 100,
    validate: {
      validator: isWholeNumber,
      message: 'refundPercent must be a whole number',
    },
  })
  refundPercent: number;
}

export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

/**
 * The policy of one airline, embedded in the airline document (see the
 * Flights data model): the cancellation tiers (FLT-09) and the extra-bag rule
 * (FLT-08). The free baggage allowance is not part of the policy: it is on
 * each cabin (FLT-04), and an extra bag has the same maximum weight as that
 * cabin's free bags (`maxBagKg`), so no weight is stored here.
 */
@Schema({ _id: false })
export class AirlinePolicy {
  /** Stored with the highest `daysBefore` first. Empty means no refund. */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  /**
   * FLT-08: the price of one extra bag, in minor units of the platform
   * currency (PAY-04), above 0. Not set until the airline moderator defines
   * the rule; the API then shows `null`.
   */
  @Prop({
    type: Number,
    min: 1,
    max: EXTRA_BAG_PRICE_MAX,
    validate: {
      validator: isWholeNumber,
      message: 'extraBagPrice must be a whole number',
    },
  })
  extraBagPrice?: number;

  /**
   * FLT-08: the most extra bags one passenger may buy, 0 or more. Not set
   * until the airline moderator defines the rule; the API then shows 0 (no
   * extra bag is sold).
   */
  @Prop({
    type: Number,
    min: 0,
    max: MAX_EXTRA_BAGS_MAX,
    validate: {
      validator: isWholeNumber,
      message: 'maxExtraBags must be a whole number',
    },
  })
  maxExtraBags?: number;
}

export const AirlinePolicySchema = SchemaFactory.createForClass(AirlinePolicy);
