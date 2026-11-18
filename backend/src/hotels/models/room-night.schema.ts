import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { ROOM_DATE_ONLY_PATTERN } from '../hotels.constants';
import { RoomNightState } from './room-night-state.enum';

/**
 * One night of one room that is not free: held, booked or blocked. It follows
 * the `ROOM_NIGHT` entity of the data model in `specs/travel-platform.md`. A
 * night with no document is free, if the room's availability covers it.
 */
@Schema({ collection: 'room_nights', timestamps: true })
export class RoomNight {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** The night, as the date it starts on (`YYYY-MM-DD`). Never a `Date`. */
  @Prop({ type: String, required: true, match: ROOM_DATE_ONLY_PATTERN })
  date: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(RoomNightState),
  })
  state: RoomNightState;

  /** The reservation that holds or booked the night. Empty when blocked. */
  @Prop({ type: SchemaTypes.ObjectId })
  bookingId?: Types.ObjectId;

  /** Only when held: a hold past this moment no longer counts. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type RoomNightDocument = HydratedDocument<RoomNight>;
export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);

// Two reservations can never have the same night of the same room (HTL-18).
RoomNightSchema.index({ roomId: 1, date: 1 }, { unique: true });
RoomNightSchema.index({ hotelId: 1, date: 1 });
