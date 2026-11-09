import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { City } from './city.schema';

@Schema({ collection: 'attractions', timestamps: true })
export class Attraction {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, ref: City.name, required: true })
  cityId: string;
}

export type AttractionDocument = HydratedDocument<Attraction>;
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
