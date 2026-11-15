import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { City } from '../../reference/models/city.schema';
import { currencyCode, wholeMinorUnits } from './money.validators';

/** ITN-16: the cost of travelling between two cities. Embedded in its day. */
@Schema()
export class TransportCost {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  mode: string;

  @Prop({ type: String, ref: City.name, required: true })
  fromCityId: string;

  @Prop({ type: String, ref: City.name, required: true })
  toCityId: string;

  @Prop({ required: true, min: 0, validate: wholeMinorUnits })
  amount: number;

  @Prop({ ...currencyCode, required: true })
  currency: string;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
