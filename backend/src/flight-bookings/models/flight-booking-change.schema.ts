import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightChangeStatus } from '../enums/flight-change-status.enum';
import {
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_BOOKING_SEGMENTS_MAX,
} from '../flight-bookings.constants';
import { BookingSegment, BookingSegmentSchema } from './flight-booking.schema';

const wholeNumber = (field: string) => ({
  validator: (value: number): boolean => Number.isInteger(value),
  message: `${field} must be a whole number`,
});

/**
 * FLT-27: one change of a confirmed flight booking to another flight on the
 * same route and in the same cabin. A new collection of this module; the
 * booking itself keeps no field about it. The change's id is the key of its
 * payment and its refund (PAY-01, PAY-03: `bookingType: flight_change`).
 *
 * Every amount is in whole minor units of `currency` (PAY-04), computed when
 * the change was made: the booked segment's price before and after (fares of
 * every seat and infant, plus the extra-bag fees on that segment), their
 * difference (positive: paid, negative: refunded) and the booking's totals
 * once the change is applied. `newSegment` is the segment that replaces
 * `segments[segmentIndex]`, with the new airline's policies copied (PAY-02).
 *
 * `open` is true while the change is `pending_payment` or `applying`; a
 * partial unique index allows one open change per booking, so two changes
 * of one booking never run at the same moment.
 */
@Schema({ collection: 'flight_booking_changes', timestamps: true })
export class FlightBookingChange {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'FlightBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** 0 the outbound flight, 1 the return flight (FLT-12). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_SEGMENTS_MAX - 1,
    validate: wholeNumber('segmentIndex'),
  })
  segmentIndex: number;

  @Prop({ type: String, required: true, enum: Object.values(CabinClass) })
  cabin: CabinClass;

  /** Adults and children: the seats moved from one flight to the other. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: FLIGHT_BOOKING_SEATS_MAX,
    validate: wholeNumber('seats'),
  })
  seats: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Flight', required: true })
  fromFlightId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Flight', required: true })
  toFlightId: Types.ObjectId;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('oldSegmentTotal'),
  })
  oldSegmentTotal: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('newSegmentTotal'),
  })
  newSegmentTotal: number;

  /** `newSegmentTotal - oldSegmentTotal`: above 0 paid, below 0 refunded. */
  @Prop({ type: Number, required: true, validate: wholeNumber('difference') })
  difference: number;

  /** The segment that replaces `segments[segmentIndex]` of the booking. */
  @Prop({ type: BookingSegmentSchema, required: true })
  newSegment: BookingSegment;

  /** The booking's `total` when the change was made. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('totalBefore'),
  })
  totalBefore: number;

  /** The booking's `fareTotal`, `baggageTotal` and `total` once applied. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('newFareTotal'),
  })
  newFareTotal: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('newBaggageTotal'),
  })
  newBaggageTotal: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('newTotal'),
  })
  newTotal: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FlightChangeStatus),
  })
  status: FlightChangeStatus;

  /** True while `pending_payment` or `applying`. */
  @Prop({ type: Boolean, required: true })
  open: boolean;

  /** PAY-02: when the user accepted the new airline's policies. */
  @Prop({ type: Date, required: true })
  policyAcceptedAt: Date;

  /** A dearer flight: until when its seats are held for the payment. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  /**
   * When the new flight's seats were held. A change without it never held
   * any (a crash before the hold): nothing is released or booked for it.
   */
  @Prop({ type: Date })
  heldAt?: Date;

  /** When the payment of the difference was taken (the webhook). */
  @Prop({ type: Date })
  paidAt?: Date;

  /** When the held seats of the new flight became booked; set once. */
  @Prop({ type: Date })
  seatsBookedAt?: Date;

  /** When the booked seats of the old flight were given back; set once. */
  @Prop({ type: Date })
  oldSeatsReleasedAt?: Date;

  /** When the seats chosen on the changed segment were freed (FLT-28); set once. */
  @Prop({ type: Date })
  chosenSeatsFreedAt?: Date;

  /**
   * The steps above whose work is done (`seatsBookedAt`, `oldSeatsReleasedAt`,
   * `chosenSeatsFreedAt`). A step is claimed before its work and listed here
   * after it, so a call running at the same moment waits for the job instead
   * of counting a step as done before it is.
   */
  @Prop({ type: [String], default: undefined })
  doneSteps?: string[];

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type FlightBookingChangeDocument = HydratedDocument<FlightBookingChange>;
export const FlightBookingChangeSchema =
  SchemaFactory.createForClass(FlightBookingChange);

/** One open change per booking: two changes never run at the same moment. */
FlightBookingChangeSchema.index(
  { bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: { open: true },
    name: 'one_open_change_per_booking',
  },
);
/** A booking's changes, newest first (details, list, cancellation refunds). */
FlightBookingChangeSchema.index({ bookingId: 1, createdAt: -1 });
/** The change job: holds that ended, and changes left `applying`. */
FlightBookingChangeSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingChangeSchema.index({ status: 1, updatedAt: 1 });
