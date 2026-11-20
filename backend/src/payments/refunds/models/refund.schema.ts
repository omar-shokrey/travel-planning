import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { BookingType } from '../../enums/booking-type.enum';
import { RefundReason } from '../enums/refund-reason.enum';
import { RefundStatus } from '../enums/refund-status.enum';

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

/**
 * The refund of one booking, or of one flight change (FLT-27), PAY-03. It
 * follows `REFUND` of the data model, plus `currency` (a copy of the
 * payment's, PAY-04). The currency, the payment and the owner come from the
 * payment, never from a caller. One (`bookingType`, `bookingId`) has at most
 * one refund; the refunds against one payment never add up to more than it.
 * `stripeRefundId` is set once Stripe took the refund; a refund without it is
 * retried by the recovery job.
 */
@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Payment', required: true })
  paymentId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /**
   * Minor units of `currency`: what is left of the payment × percent / 100,
   * rounded; or the exact amount of a fare difference (FLT-27).
   */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: { validator: isWholeNumber, message: 'Amount must be whole' },
  })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 100,
    validate: {
      validator: isWholeNumber,
      message: 'refundPercent must be whole',
    },
  })
  refundPercent: number;

  @Prop({ type: String, enum: Object.values(RefundReason), required: true })
  reason: RefundReason;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    required: true,
    default: RefundStatus.Pending,
  })
  status: RefundStatus;

  /** Stripe's refund id (`re_...`). Not a secret; never set by a client. */
  @Prop({ type: String })
  stripeRefundId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);

// One refund per (bookingType, bookingId): a retried cancellation finds it. A
// flight change (FLT-27) has its own key, so a booking can also have the
// refunds of its changes.
RefundSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
// The webhook finds a refund by Stripe's id; only sent refunds have one.
RefundSchema.index({ stripeRefundId: 1 }, { unique: true, sparse: true });
// The recovery job finds the pending refunds Stripe has not taken yet.
RefundSchema.index({ status: 1, createdAt: 1 });
