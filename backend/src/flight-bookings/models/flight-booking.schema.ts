import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../flights/models/airline-policy.schema';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import {
  FLIGHT_BOOKING_ADULTS_MIN,
  FLIGHT_BOOKING_PASSENGERS_MAX,
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_BOOKING_SEGMENTS_MAX,
  PASSENGER_FULL_NAME_MAX_LENGTH,
  PASSPORT_NUMBER_MAX_LENGTH,
  PASSPORT_NUMBER_PATTERN,
} from '../flight-bookings.constants';

/** A calendar date with no time (`YYYY-MM-DD`). */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A validator that refuses 1.5 seats or 12.5 cents: `min` alone would let them in. */
const wholeNumber = (field: string) => ({
  validator: (value: number): boolean => Number.isInteger(value),
  message: `${field} must be a whole number`,
});

/**
 * One flight of a booking (FLT-22), as in `BOOKING_SEGMENT` of the data
 * model. The flight times are always read from the flight; the fare is a
 * copy of the cabin price when the seats were held (FLT-05). PAY-02 copies
 * the airline's policy and the cabin's free allowance at the same moment, so
 * the policy the user is shown and accepts is the one a refund (FLT-26) and
 * the extra bags (FLT-19) use, whatever the airline changes later. A segment
 * saved before PAY-02 has no copy: empty tiers, no extra bag rule, and no
 * free allowance.
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

  /** PAY-02: copy of the airline's cancellation tiers, highest `daysBefore` first. Empty means no refund. */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  /** PAY-02: copy of the airline's price of one extra bag, minor units. Unset when the airline has no rule. */
  @Prop({ type: Number, min: 1, validate: wholeNumber('extraBagPrice') })
  extraBagPrice?: number;

  /** PAY-02: copy of the most extra bags one passenger may buy. 0 when the airline has no rule. */
  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: wholeNumber('maxExtraBags'),
  })
  maxExtraBags: number;

  /** PAY-02: copy of the cabin's free checked bags per passenger (FLT-04). */
  @Prop({ type: Number, min: 0, validate: wholeNumber('freeBags') })
  freeBags?: number;

  /** PAY-02: copy of the cabin's maximum weight of one bag in kg, also for an extra bag (FLT-04, FLT-08). */
  @Prop({ type: Number, min: 1, validate: wholeNumber('maxBagKg') })
  maxBagKg?: number;
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
 * FLT-19: the extra bags of one passenger on one segment, as in
 * `PASSENGER_BAGGAGE` of the data model. `segment` is 0 for the outbound
 * flight; FLT-12 adds 1 for the return flight.
 */
@Schema({ _id: false })
export class PassengerBaggage {
  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_SEGMENTS_MAX - 1,
    validate: wholeNumber('segment'),
  })
  segment: number;

  @Prop({ type: Number, required: true, min: 1, validate: wholeNumber('bags') })
  bags: number;

  /** The total weight of these bags, in kg. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: wholeNumber('weightKg'),
  })
  weightKg: number;
}

export const PassengerBaggageSchema =
  SchemaFactory.createForClass(PassengerBaggage);

/**
 * FLT-19: one passenger, as in `PASSENGER` of the data model. The type is
 * derived by the server (FLT-12(b)). The messages never repeat a value,
 * because these are personal data.
 */
@Schema({ _id: false })
export class Passenger {
  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: [
      PASSENGER_FULL_NAME_MAX_LENGTH,
      `fullName must have at most ${PASSENGER_FULL_NAME_MAX_LENGTH} characters`,
    ],
  })
  fullName: string;

  /** `YYYY-MM-DD`, never a `Date`, so no time zone can shift it. */
  @Prop({
    type: String,
    required: true,
    match: [
      DATE_ONLY_PATTERN,
      'dateOfBirth must be a date in the form YYYY-MM-DD',
    ],
  })
  dateOfBirth: string;

  /** Upper-case letters and digits. */
  @Prop({
    type: String,
    required: true,
    maxlength: [
      PASSPORT_NUMBER_MAX_LENGTH,
      `passportNumber must have at most ${PASSPORT_NUMBER_MAX_LENGTH} characters`,
    ],
    match: [
      PASSPORT_NUMBER_PATTERN,
      'passportNumber must contain only upper-case letters and digits',
    ],
  })
  passportNumber: string;

  @Prop({ type: String, required: true, enum: Object.values(PassengerType) })
  type: PassengerType;

  /** Extra bags per segment. Empty when the passenger bought none. */
  @Prop({ type: [PassengerBaggageSchema], default: [] })
  baggage: PassengerBaggage[];
}

export const PassengerSchema = SchemaFactory.createForClass(Passenger);

/**
 * A flight booking, as in `FLIGHT_BOOKING` of the data model in
 * `specs/travel-platform.md`: the seats are held for 10 minutes while the
 * payment is pending (FLT-22), with the passengers and their extra bags
 * (FLT-19). `policyAcceptedAt` is set by PAY-02. The fields of later issues
 * (`cancelledAt`, `cancelledBy`, `refundPercent` FLT-26) are added by them.
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

  /**
   * FLT-19: minor units, the extra bag fees of every passenger. 0 for a
   * booking without extra bags, and for one saved before FLT-19.
   */
  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: wholeNumber('baggageTotal'),
  })
  baggageTotal: number;

  /** Minor units: what the user pays, `fareTotal + baggageTotal`. */
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

  /** How many adults, children and infants: derived from `passengers` (FLT-19). */
  @Prop({ type: PassengerCountsSchema, required: true })
  passengerCounts: PassengerCounts;

  /**
   * FLT-19: every passenger with their details and extra bags. A booking
   * saved before FLT-19 has none; the service always saves at least one.
   */
  @Prop({
    type: [PassengerSchema],
    default: [],
    validate: {
      validator: (passengers: Passenger[]): boolean =>
        passengers.length <= FLIGHT_BOOKING_PASSENGERS_MAX,
      message: `A booking has at most ${FLIGHT_BOOKING_PASSENGERS_MAX} passengers`,
    },
  })
  passengers: Passenger[];

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
