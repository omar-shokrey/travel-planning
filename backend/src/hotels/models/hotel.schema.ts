import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { City } from '../../reference/models/city.schema';
import { Country } from '../../reference/models/country.schema';
import {
  HOTEL_ADDRESS_MAX_LENGTH,
  HOTEL_AMENITIES_MAX_COUNT,
  HOTEL_AMENITY_MAX_LENGTH,
  HOTEL_DESCRIPTION_MAX_LENGTH,
  HOTEL_NAME_MAX_LENGTH,
  HOTEL_STAR_CLASS_MAX,
  HOTEL_STAR_CLASS_MIN,
} from '../hotels.constants';

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: HOTEL_NAME_MAX_LENGTH,
  })
  name: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: HOTEL_ADDRESS_MAX_LENGTH,
  })
  addressLine: string;

  @Prop({ type: String, ref: City.name, required: true })
  cityId: string;

  @Prop({ type: String, ref: Country.name, required: true })
  countryCode: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: HOTEL_DESCRIPTION_MAX_LENGTH,
  })
  description: string;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop({
    type: Number,
    required: true,
    min: HOTEL_STAR_CLASS_MIN,
    max: HOTEL_STAR_CLASS_MAX,
    validate: {
      validator: (starClass: number) => Number.isInteger(starClass),
      message: 'Star class must be a whole number',
    },
  })
  starClass: number;

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (amenities: string[]) =>
        amenities.length <= HOTEL_AMENITIES_MAX_COUNT &&
        amenities.every(
          (amenity) => amenity.length <= HOTEL_AMENITY_MAX_LENGTH,
        ),
      message: `Amenities must contain at most ${HOTEL_AMENITIES_MAX_COUNT} items of at most ${HOTEL_AMENITY_MAX_LENGTH} characters`,
    },
  })
  amenities: string[];

  @Prop({ type: Boolean, required: true, default: true })
  active: boolean;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  ratingCount: number;

  @Prop({ type: Number, required: true, min: 0, max: 5, default: 0 })
  averageRating: number;

  createdAt: Date;
  updatedAt: Date;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);

HotelSchema.index({ cityId: 1, active: 1 });
