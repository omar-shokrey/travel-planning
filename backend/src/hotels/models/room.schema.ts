import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { Hotel } from './hotel.schema';

@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  @Prop({ type: SchemaTypes.ObjectId, ref: Hotel.name, required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  number: string;

  @Prop({ type: String, required: true, trim: true })
  type: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Beds must be a whole number',
    },
  })
  beds: number;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Maximum occupancy must be a whole number',
    },
  })
  maxOccupancy: number;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Price per night must be a whole number of minor units',
    },
  })
  pricePerNight: number;

  @Prop({ type: Boolean, required: true, default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);

RoomSchema.index({ hotelId: 1, number: 1 }, { unique: true });
