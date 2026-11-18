import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { type HydratedDocument, type Types } from 'mongoose';

export enum FlightStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
  Departed = 'departed',
}

@Schema({ collection: 'flights', timestamps: true })
export class Flight {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  airlineId: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  flightNumber: string;

  @Prop({ required: true, trim: true, uppercase: true })
  departureAirport: string;

  @Prop({ required: true, trim: true, uppercase: true })
  arrivalAirport: string;

  @Prop({ required: true, type: Date })
  departureAt: Date;

  @Prop({ required: true, type: Date })
  arrivalAt: Date;

  @Prop({ required: true })
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
