import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

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
 * Flights data model). For now it holds only the cancellation tiers; the
 * baggage fields (`extraBagPrice`, `maxExtraBags`) come with FLT-04 and FLT-08.
 */
@Schema({ _id: false })
export class AirlinePolicy {
  /** Stored with the highest `daysBefore` first. Empty means no refund. */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];
}

export const AirlinePolicySchema = SchemaFactory.createForClass(AirlinePolicy);
