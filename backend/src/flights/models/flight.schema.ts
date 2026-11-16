import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types, type HydratedDocument } from 'mongoose';

export enum FlightStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
  Departed = 'departed',
}

@Schema({ _id: false })
export class FlightCabin {
  @Prop({
    type: String,
    required: true,
    enum: ['economy', 'premium_economy', 'business', 'first'],
  })
  cabin: string;

  @Prop({ type: Number, required: true, min: 1 })
  totalSeats: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  bookedSeats: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  heldSeats: number;

  @Prop({ type: Number, required: true, min: 0 })
  price: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  freeBags: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxBagKg: number;
}

export const FlightCabinSchema = SchemaFactory.createForClass(FlightCabin);

@Schema({ collection: 'flights', timestamps: true })
export class Flight {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Airline',
    required: true,
  })
  airlineId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  flightNumber: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  })
  departureAirport: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  })
  arrivalAirport: string;

  @Prop({ type: Date, required: true })
  departureAt: Date;

  @Prop({ type: Date, required: true })
  arrivalAt: Date;

  @Prop({
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  })
  departureDateLocal: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FlightStatus),
    default: FlightStatus.Scheduled,
  })
  status: FlightStatus;

  @Prop({
    type: [FlightCabinSchema],
    required: true,
    validate: {
      validator: (cabins: FlightCabin[]) =>
        Array.isArray(cabins) && cabins.length >= 1 && cabins.length <= 4,
      message: 'A flight must have between 1 and 4 cabins',
    },
  })
  cabins: FlightCabin[];
}

export type FlightDocument = HydratedDocument<Flight>;

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index(
  {
    airlineId: 1,
    flightNumber: 1,
    departureDateLocal: 1,
  },
  { unique: true },
);

FlightSchema.index({
  departureAirport: 1,
  arrivalAirport: 1,
  departureDateLocal: 1,
  status: 1,
});
