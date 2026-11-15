import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { TIME_OF_DAY_PATTERN } from '../itineraries.constants';
import { currencyCode, wholeMinorUnits } from './money.validators';

/** ITN-10, ITN-12: something to do on a day. Embedded in the day. */
@Schema()
export class Activity {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  /** Optional time of day, HH:mm. */
  @Prop({ match: TIME_OF_DAY_PATTERN })
  time?: string;

  /** Optional cost in minor units. It counts under Activities in the budget (ITN-14). */
  @Prop({ min: 0, validate: wholeMinorUnits })
  cost?: number;

  @Prop(currencyCode)
  currency?: string;

  /** File names returned by UploadsService, at most 5 (GEN-08). */
  @Prop({ type: [String], default: [] })
  images: string[];
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
