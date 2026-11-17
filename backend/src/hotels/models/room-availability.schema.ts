import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ROOM_DATE_ONLY_PATTERN } from '../hotels.constants';

@Schema({ _id: false })
export class RoomAvailability {
  @Prop({
    type: String,
    required: true,
    match: ROOM_DATE_ONLY_PATTERN,
  })
  from: string;

  @Prop({
    type: String,
    required: true,
    match: ROOM_DATE_ONLY_PATTERN,
    validate: {
      validator: function (this: RoomAvailability, value: string): boolean {
        return this.from < value;
      },
      message: 'to must be after from',
    },
  })
  to: string;
}

export const RoomAvailabilitySchema =
  SchemaFactory.createForClass(RoomAvailability);
