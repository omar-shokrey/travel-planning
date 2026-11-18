import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** A time of day on the 24-hour clock, such as `14:00`. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One step of the hotel's cancellation policy (HTL-10): cancelling at least
 * `daysBefore` days before check-in refunds `refundPercent` of the total.
 */
@Schema({ _id: false })
export class CancellationTier {
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (value: number) => Number.isInteger(value),
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
      validator: (value: number) => Number.isInteger(value),
      message: 'refundPercent must be a whole number',
    },
  })
  refundPercent: number;
}

export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

/**
 * The policy of one hotel, embedded in the hotel document because it belongs
 * to exactly one hotel (HTL-09, HTL-10). The times are local to the hotel and
 * have no date, so they are `HH:mm` strings and never a `Date`.
 */
@Schema({ _id: false })
export class HotelPolicy {
  @Prop({ type: String, required: true, match: TIME_OF_DAY_PATTERN })
  checkInTime: string;

  @Prop({ type: String, required: true, match: TIME_OF_DAY_PATTERN })
  checkOutTime: string;

  /** Stored with the highest `daysBefore` first. Empty means no refund. */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];
}

export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);
