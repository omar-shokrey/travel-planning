import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import {
  FLIGHT_BOOKING_PASSENGERS_MAX,
  FLIGHT_BOOKING_SEGMENTS_MAX,
} from '../flight-bookings.constants';
import { SEAT_NUMBER_PATTERN } from '../seat-map';

const wholeNumber = (field: string) => ({
  validator: (value: number): boolean => Number.isInteger(value),
  message: `${field} must be a whole number`,
});

/**
 * FLT-28: the seat one passenger of a booking holds on one segment. This
 * collection is the only record of chosen seats: the flight and the booking
 * store none. The passenger is the position in the booking's `passengers`
 * (passengers have no id of their own), and the segment the position in its
 * `segments` (0 outbound, 1 return).
 */
@Schema({ collection: 'flight_seat_assignments', timestamps: true })
export class FlightSeatAssignment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(CabinClass) })
  cabin: CabinClass;

  @Prop({ type: String, required: true, match: SEAT_NUMBER_PATTERN })
  seatNumber: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'FlightBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_SEGMENTS_MAX - 1,
    validate: wholeNumber('segmentIndex'),
  })
  segmentIndex: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: FLIGHT_BOOKING_PASSENGERS_MAX - 1,
    validate: wholeNumber('passengerIndex'),
  })
  passengerIndex: number;

  createdAt: Date;
  updatedAt: Date;
}

export type FlightSeatAssignmentDocument =
  HydratedDocument<FlightSeatAssignment>;
export const FlightSeatAssignmentSchema =
  SchemaFactory.createForClass(FlightSeatAssignment);

// One passenger per seat: the index decides two users who want the same seat.
FlightSeatAssignmentSchema.index(
  { flightId: 1, cabin: 1, seatNumber: 1 },
  { unique: true },
);
// One seat per passenger and segment: a seat change rewrites this document.
FlightSeatAssignmentSchema.index(
  { bookingId: 1, segmentIndex: 1, passengerIndex: 1 },
  { unique: true },
);
