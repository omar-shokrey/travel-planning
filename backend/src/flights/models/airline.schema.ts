import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { AirlinePolicy, AirlinePolicySchema } from './airline-policy.schema';

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

  /**
   * The cancellation tiers (FLT-09), later also the baggage rules. An airline
   * stored before FLT-09 has none, so readers treat a missing policy as empty.
   */
  @Prop({ type: AirlinePolicySchema, default: () => ({}) })
  policy?: AirlinePolicy;

  /** Written by Mongoose (`timestamps: true`). Declared here only for the types. */
  createdAt: Date;
  updatedAt: Date;
}

export type AirlineDocument = HydratedDocument<Airline>;

export const AirlineSchema = SchemaFactory.createForClass(Airline);

AirlineSchema.index({ code: 1 }, { unique: true });
