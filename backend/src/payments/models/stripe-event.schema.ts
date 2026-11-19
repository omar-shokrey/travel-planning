import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { STRIPE_EVENT_TTL_SECONDS } from '../payments.constants';

/**
 * The id of every webhook event that was processed (PAY-01). When Stripe sends
 * the same event again, the id already exists and the handler ignores it.
 */
@Schema({ collection: 'stripe_events' })
export class StripeEvent {
  /** The Stripe event id (`evt_...`). */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Date, required: true })
  processedAt: Date;
}

export type StripeEventDocument = HydratedDocument<StripeEvent>;
export const StripeEventSchema = SchemaFactory.createForClass(StripeEvent);

// Stripe stops retrying an event after a few days, so old ids can go.
StripeEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: STRIPE_EVENT_TTL_SECONDS },
);
