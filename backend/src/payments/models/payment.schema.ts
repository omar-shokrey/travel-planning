import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { BookingType } from '../enums/booking-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

/**
 * The payment of one booking (PAY-01). It follows `PAYMENT` of the data model:
 * only the Stripe payment id, the amount, the currency and the status are
 * stored, never a card detail or the PaymentIntent's client secret.
 * `holdExpiresAt` is a copy of the booking's hold, so the expiry job can cancel
 * the PaymentIntent when the hold ends without reading the booking.
 */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  stripePaymentIntentId: string;

  /** Minor units of the platform currency (PAY-04), copied from the booking total. */
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
    type: String,
    enum: Object.values(PaymentStatus),
    required: true,
    default: PaymentStatus.RequiresPayment,
  })
  status: PaymentStatus;

  @Prop({ type: Date, required: true })
  holdExpiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);

// A booking has one payment, and a retry reuses its PaymentIntent.
PaymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
PaymentSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
// The expiry job finds the open payments whose hold has ended.
PaymentSchema.index({ status: 1, holdExpiresAt: 1 });
