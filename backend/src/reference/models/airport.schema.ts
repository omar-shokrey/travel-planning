import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { City } from './city.schema';
import { Country } from './country.schema';

const isValidTimeZone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

@Schema({ collection: 'airports', timestamps: true })
export class Airport {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, ref: City.name, required: true })
  cityId: string;

  @Prop({ type: String, ref: Country.name, required: true })
  countryCode: string;

  @Prop({
    required: true,
    validate: {
      validator: isValidTimeZone,
      message: 'timeZone must be a valid IANA time zone',
    },
  })
  timeZone: string;
}

export type AirportDocument = HydratedDocument<Airport>;
export const AirportSchema = SchemaFactory.createForClass(Airport);
