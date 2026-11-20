import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type Types } from 'mongoose';
import { LinkedBookingType } from '../enums/linked-booking-type.enum';
import { currencyCode, moneyAmount } from './money.validators';

/**
 * ITN-27: a booked flight or hotel linked to a day. Embedded in the day. It
 * keeps a copy of the booking's reference, total and currency taken when it
 * was linked, like every other copy of a booking in the project: the booking
 * itself is never read again for the budget.
 */
@Schema()
export class LinkedBooking {
  _id: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(LinkedBookingType),
  })
  bookingType: LinkedBookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  reference: string;

  /** The booking's total, whole minor units. */
  @Prop({ required: true, ...moneyAmount })
  amount: number;

  @Prop({ ...currencyCode, required: true })
  currency: string;
}

export const LinkedBookingSchema = SchemaFactory.createForClass(LinkedBooking);
