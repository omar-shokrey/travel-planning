import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

@Schema({ collection: 'airlines', timestamps: true })
export class Airline {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true })
  logo: string;

  @Prop({ default: true })
  active: boolean;

  /** Written by Mongoose (`timestamps: true`). Declared here only for the types. */
  createdAt: Date;
  updatedAt: Date;
}

export type AirlineDocument = HydratedDocument<Airline>;

export const AirlineSchema = SchemaFactory.createForClass(Airline);

AirlineSchema.index({ code: 1 }, { unique: true });
