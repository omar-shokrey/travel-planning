import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

@Schema({ collection: 'countries', timestamps: true })
export class Country {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  currency: string;
}

export type CountryDocument = HydratedDocument<Country>;
export const CountrySchema = SchemaFactory.createForClass(Country);
