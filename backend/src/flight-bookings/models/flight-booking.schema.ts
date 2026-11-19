import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import {
  FLIGHT_BOOKING_ADULTS_MIN,
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_BOOKING_SEGMENTS_MAX,
} from '../flight-bookings.constants';

/** A validator that refuses 1.5 seats or 12.5 cents: `min` alone would let them in. */
const wholeNumber = (field: string) => ({
  validator: (value: number): boolean => Number.isInteger(value),
  message: `${field} must be a whole number`,
});

/**
 * One flight of a booking (FLT-22), as in `BOOKING_SEGMENT` of the data
 * model. The flight times are always read from the flight; the fare is a
 * copy of the cabin price when the seats were held (FLT-05). The extra bag
 * price and the cancellation tiers are added by FLT-19 and FLT-26.
 */
@Schema({ _id: false })
export class BookingSegment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(CabinClass) })
  cabin: CabinClass;

  /** Minor units of the platform currency per adult or child seat, at booking time. */
  @Prop({ type: Number, required: true, min: 1, validate: wholeNumber('fare') })
  fare: number;

  /** Adults and children only: infants occupy no seat (FLT-12). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: FLIGHT_BOOKING_SEATS_MAX,
    validate: wholeNumber('seatsReserved'),
  })
  seatsReserved: number;
}

export const BookingSegmentSchema =
  SchemaFactory.createForClass(BookingSegment);

/** How many passengers of each type the booking is for (FLT-12). */
@Schema({ _id: false })
export class PassengerCounts {
  @Prop({
    type: Number,
    required: true,
    min: FLIGHT_BOOKING_ADULTS_MIN,
    max: FLIGHT_BOOKING_SEATS_MAX,
    validate: wholeNumber('adults'),
  })
  adults: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_SEATS_MAX,
    validate: wholeNumber('children'),
  })
  children: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_SEATS_MAX,
    validate: wholeNumber('infants'),
  })
  infants: number;
}

export const PassengerCountsSchema =
  SchemaFactory.createForClass(PassengerCounts);

/**
 * A flight booking, as in `FLIGHT_BOOKING` of the data model in
 * `specs/travel-platform.md`, with what FLT-22 needs: the seats are held for
 * 10 minutes while the payment is pending. `policyAcceptedAt` is set by
 * PAY-02. The fields of later issues (passengers and baggage FLT-19,
 * `baggageTotal`, `cancelledAt`, `cancelledBy`, `refundPercent` FLT-26) are
 * added by them.
 */
@Schema({ collection: 'flight_bookings', timestamps: true })
export class FlightBooking {
  /** Given when the booking is confirmed after payment (FLT-23). */
  @Prop({ type: String })
  reference?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FlightBookingStatus),
  })
  status: FlightBookingStatus;

  /** FLT-22: until when the seats are held. Required while the payment is pending. */
  @Prop({
    type: Date,
    required: function (this: FlightBooking): boolean {
      return this.status === FlightBookingStatus.PendingPayment;
    },
  })
  holdExpiresAt?: Date;

  /**
   * PAY-02: when the user accepted the airline's policies, before payment.
   * Not set until then; set once and never moved.
   */
  @Prop({ type: Date })
  policyAcceptedAt?: Date;

  /** The platform currency (PAY-04). */
  @Prop({ type: String, required: true })
  currency: string;

  /** Minor units: the fares of every seat and every infant. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('fareTotal'),
  })
  fareTotal: number;

  /** Minor units: what the user pays. Equal to `fareTotal` until baggage (FLT-19). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: wholeNumber('total'),
  })
  total: number;

  @Prop({
    type: [BookingSegmentSchema],
    required: true,
    validate: {
      validator: (segments: BookingSegment[]): boolean =>
        segments.length >= 1 && segments.length <= FLIGHT_BOOKING_SEGMENTS_MAX,
      message: `A booking has 1 to ${FLIGHT_BOOKING_SEGMENTS_MAX} segments`,
    },
  })
  segments: BookingSegment[];

  @Prop({ type: PassengerCountsSchema, required: true })
  passengerCounts: PassengerCounts;

  createdAt: Date;
  updatedAt: Date;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// Only confirmed bookings have a reference, so the index skips the rest.
FlightBookingSchema.index({ reference: 1 }, { unique: true, sparse: true });
/** A user's bookings by status (FLT-25). */
FlightBookingSchema.index({ userId: 1, status: 1 });
/** The bookings of a flight (FLT-06 cancellation, FLT-29 passenger export). */
FlightBookingSchema.index({ 'segments.flightId': 1 });
/** The hold-expiry job (FLT-22). */
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
