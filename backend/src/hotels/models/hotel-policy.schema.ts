import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** A time of day on the 24-hour clock, such as `14:00`. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The policy of one hotel, embedded in the hotel document because it belongs
 * to exactly one hotel (HTL-09). The times are local to the hotel and have no
 * date, so they are `HH:mm` strings and never a `Date`.
 */
@Schema({ _id: false })
export class HotelPolicy {
  @Prop({ type: String, required: true, match: TIME_OF_DAY_PATTERN })
  checkInTime: string;

  @Prop({ type: String, required: true, match: TIME_OF_DAY_PATTERN })
  checkOutTime: string;
}

export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);
