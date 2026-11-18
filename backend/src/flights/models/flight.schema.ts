import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  type HydratedDocument,
  type Types,
} from 'mongoose';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
  LOCAL_DATE_PATTERN,
} from '../flights.constants';
import { Airline } from './airline.schema';
import { CabinClass } from './cabin-class.enum';
import { FlightStatus } from './flight-status.enum';

/** A validator that refuses 1.5 seats or 12.5 cents: `min` alone would let them in. */
const wholeNumber = (field: string) => ({
  validator: (value: number): boolean => Number.isInteger(value),
  message: `${field} must be a whole number`,
});

/**
 * One cabin category of a flight (FLT-04), embedded in the flight so the seat
 * counters live in the same document and one conditional update can reserve
 * seats only if enough remain (FLT-22). Its own `_id` is the `cabinId` of the
 * routes. `bookedSeats` and `heldSeats` are set by the server only (the
 * booking, FLT-22); the API returns `availableSeats` instead
 * (`totalSeats - bookedSeats - heldSeats`). `price` is in minor units of the
 * platform currency (PAY-04), per seat. The limits are in `flights.constants.ts`.
 */
@Schema()
export class FlightCabin {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String, enum: Object.values(CabinClass) })
  cabin: CabinClass;

  @Prop({
    required: true,
    type: Number,
    min: 1,
    max: CABIN_SEATS_MAX,
    validate: wholeNumber('totalSeats'),
  })
  totalSeats: number;

  @Prop({
    required: true,
    type: Number,
    default: 0,
    min: 0,
    validate: wholeNumber('bookedSeats'),
  })
  bookedSeats: number;

  @Prop({
    required: true,
    type: Number,
    default: 0,
    min: 0,
    validate: wholeNumber('heldSeats'),
  })
  heldSeats: number;

  @Prop({
    required: true,
    type: Number,
    min: 1,
    max: CABIN_PRICE_MAX,
    validate: wholeNumber('price'),
  })
  price: number;

  @Prop({
    required: true,
    type: Number,
    min: 0,
    max: CABIN_FREE_BAGS_MAX,
    validate: wholeNumber('freeBags'),
  })
  freeBags: number;

  @Prop({
    required: true,
    type: Number,
    min: 1,
    max: CABIN_BAG_WEIGHT_MAX_KG,
    validate: wholeNumber('maxBagKg'),
  })
  maxBagKg: number;
}

export const FlightCabinSchema = SchemaFactory.createForClass(FlightCabin);

/** Each cabin class at most once per flight, so a flight has at most 4 cabins. */
const eachClassOnce = (cabins: Pick<FlightCabin, 'cabin'>[]): boolean =>
  new Set(cabins.map(({ cabin }) => cabin)).size === cabins.length;

/**
 * A flight (FLT-03). The times are UTC instants; `departureDateLocal` is the
 * calendar date at the departure airport, for search by local date (FLT-11)
 * and for the rule that an airline cannot repeat a flight number on the same
 * departure date. Every field is set by the service and none has a default,
 * except `cabins` (FLT-04), which starts empty: the moderator adds the cabins
 * one by one after creating the flight. A flight stored before FLT-04 has no
 * `cabins` field, and the mapper reads it as an empty list.
 */
@Schema({ collection: 'flights', timestamps: true })
export class Flight {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Airline.name,
  })
  airlineId: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  flightNumber: string;

  /** IATA code from the airports list (FLT-02). */
  @Prop({ required: true, trim: true, uppercase: true })
  departureAirport: string;

  /** IATA code from the airports list (FLT-02). */
  @Prop({ required: true, trim: true, uppercase: true })
  arrivalAirport: string;

  @Prop({ required: true, type: Date })
  departureAt: Date;

  @Prop({ required: true, type: Date })
  arrivalAt: Date;

  @Prop({ required: true, type: String, match: LOCAL_DATE_PATTERN })
  departureDateLocal: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(FlightStatus),
  })
  status: FlightStatus;

  @Prop({
    type: [FlightCabinSchema],
    default: [],
    validate: {
      validator: eachClassOnce,
      message: 'A flight has each cabin class at most once',
    },
  })
  cabins: FlightCabin[];

  createdAt: Date;
  updatedAt: Date;
}

export type FlightDocument = HydratedDocument<Flight>;

export const FlightSchema = SchemaFactory.createForClass(Flight);

/**
 * One flight number per airline and departure date (FLT-03), whatever the
 * status: a cancelled flight still holds its number on that date. A
 * duplicate insert fails with E11000, which the service answers with 409.
 */
FlightSchema.index(
  {
    airlineId: 1,
    flightNumber: 1,
    departureDateLocal: 1,
  },
  { unique: true },
);

/** Flight search by route and local date (FLT-11). */
FlightSchema.index({
  departureAirport: 1,
  arrivalAirport: 1,
  departureDateLocal: 1,
  status: 1,
});
