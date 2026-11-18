import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  type HydratedDocument,
  type Types,
} from 'mongoose';
import { LOCAL_DATE_PATTERN } from '../flights.constants';
import { Airline } from './airline.schema';
import { FlightStatus } from './flight-status.enum';

/**
 * A flight (FLT-03). The times are UTC instants; `departureDateLocal` is the
 * calendar date at the departure airport, for search by local date (FLT-11)
 * and for the rule that an airline cannot repeat a flight number on the same
 * departure date. Every field is set by the service: none has a default.
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
