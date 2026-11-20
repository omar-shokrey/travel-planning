import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { ROOM_DATE_ONLY_PATTERN } from '../../hotels/hotels.constants';
import {
  CancellationTier,
  CancellationTierSchema,
  TIME_OF_DAY_PATTERN,
} from '../../hotels/models/hotel-policy.schema';
import { CancelledBy } from '../../flight-bookings/enums/cancelled-by.enum';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import { CHILD_AGE_MAX, CHILD_AGE_MIN } from '../hotel-bookings.constants';

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

/**
 * One room of a reservation (HTL-16), with its price and its guests as they
 * were when the reservation was made.
 */
@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  /** The room number and type at booking time, such as `101 (Double)`. */
  @Prop({ type: String, required: true })
  roomLabel: string;

  /** Minor units of the platform currency, at booking time. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: { validator: isWholeNumber, message: 'Price must be whole' },
  })
  pricePerNight: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: { validator: isWholeNumber, message: 'Adults must be whole' },
  })
  adults: number;

  @Prop({
    type: [Number],
    default: [],
    validate: {
      validator: (ages: number[]) =>
        ages.every(
          (age) =>
            Number.isInteger(age) &&
            age >= CHILD_AGE_MIN &&
            age <= CHILD_AGE_MAX,
        ),
      message: `Each child age must be a whole number from ${CHILD_AGE_MIN} to ${CHILD_AGE_MAX}`,
    },
  })
  childAges: number[];
}

export const BookedRoomSchema = SchemaFactory.createForClass(BookedRoom);

/**
 * A hotel reservation: one or more rooms of one hotel for the same dates
 * (HTL-16). It follows the `HOTEL_BOOKING` entity of the data model in
 * `specs/travel-platform.md`. The price, the times and the cancellation tiers
 * are copies, so a later change by the hotel does not change the reservation.
 * `policyAcceptedAt` is set by PAY-02. `cancelledAt`, `cancelledBy` and
 * `refundPercent` are set when it is cancelled (HTL-21).
 */
@Schema({ collection: 'hotel_bookings', timestamps: true })
export class HotelBooking {
  /** Given when the reservation is confirmed after payment (HTL-17). */
  @Prop({ type: String })
  reference?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** `YYYY-MM-DD`, never a `Date`. */
  @Prop({ type: String, required: true, match: ROOM_DATE_ONLY_PATTERN })
  checkIn: string;

  /** `YYYY-MM-DD`, never a `Date`. */
  @Prop({ type: String, required: true, match: ROOM_DATE_ONLY_PATTERN })
  checkOut: string;

  @Prop({ type: Number, required: true, min: 1 })
  nights: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(HotelBookingStatus),
  })
  status: HotelBookingStatus;

  /** HTL-18: until when the rooms are held while the payment is pending. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  /**
   * PAY-02: when the user accepted the hotel's policies, before payment.
   * Not set until then; set once and never moved.
   */
  @Prop({ type: Date })
  policyAcceptedAt?: Date;

  /** The platform currency (PAY-04). */
  @Prop({ type: String, required: true })
  currency: string;

  /** Sum over the rooms of nights x price per night, in minor units. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: { validator: isWholeNumber, message: 'Total must be whole' },
  })
  total: number;

  @Prop({ type: [BookedRoomSchema], required: true })
  rooms: BookedRoom[];

  /** Copies of the hotel's times (HTL-09); empty if the hotel had none. */
  @Prop({ type: String, match: TIME_OF_DAY_PATTERN })
  checkInTime?: string;

  @Prop({ type: String, match: TIME_OF_DAY_PATTERN })
  checkOutTime?: string;

  /** Copy of the hotel's cancellation tiers (HTL-10), for HTL-21. */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  /** HTL-21: when it was cancelled. Set once, with the status. */
  @Prop({ type: Date })
  cancelledAt?: Date;

  /** HTL-21: who cancelled it (data model: "user or provider"). */
  @Prop({ type: String, enum: Object.values(CancelledBy) })
  cancelledBy?: CancelledBy;

  /** HTL-21: the refund in percent, from the copied tiers, when it was cancelled. */
  @Prop({
    type: Number,
    min: 0,
    max: 100,
    validate: {
      validator: isWholeNumber,
      message: 'refundPercent must be whole',
    },
  })
  refundPercent?: number;

  createdAt: Date;
  updatedAt: Date;
}

export type HotelBookingDocument = HydratedDocument<HotelBooking>;
export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

// Only confirmed reservations have a reference, so the index skips the rest.
HotelBookingSchema.index({ reference: 1 }, { unique: true, sparse: true });
// HTL-18: the hold-expiry job finds the due pending_payment reservations.
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// GEN-11: the completion job finds the confirmed reservations past check-out.
HotelBookingSchema.index({ status: 1, checkOut: 1 });
