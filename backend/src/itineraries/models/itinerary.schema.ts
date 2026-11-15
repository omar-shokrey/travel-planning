import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { Country } from '../../reference/models/country.schema';
import { User } from '../../users/models/user.schema';
import { ItineraryModeration } from '../enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import {
  DATE_ONLY_PATTERN,
  ITINERARY_MAX_DAYS,
  ITINERARY_TITLE_MAX,
} from '../itineraries.constants';
import { CloneSource, CloneSourceSchema } from './clone-source.schema';
import { ItineraryDay, ItineraryDaySchema } from './itinerary-day.schema';

/**
 * An itinerary with everything under it (days, activities, budget entries,
 * transport costs) in one document. It has one owner, is bounded by the 60-day
 * limit and is always loaded together.
 */
@Schema({ collection: 'itineraries', timestamps: true })
export class Itinerary {
  /** Set by the service from the login cookie, never by the client. */
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: ITINERARY_TITLE_MAX })
  title: string;

  /** Country codes from the seeded country list, at least one (ITN-01). */
  @Prop({
    type: [{ type: String, ref: Country.name }],
    required: true,
    validate: {
      validator: (countries: string[]) => countries.length > 0,
      message: 'An itinerary needs at least one country',
    },
  })
  countries: string[];

  /** A calendar date, YYYY-MM-DD. Day dates derive from it (ITN-05). */
  @Prop({ required: true, match: DATE_ONLY_PATTERN })
  startDate: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ItineraryVisibility),
    default: ItineraryVisibility.Private,
  })
  visibility: ItineraryVisibility;

  @Prop({
    type: [ItineraryDaySchema],
    default: [],
    validate: {
      validator: (days: ItineraryDay[]) => days.length <= ITINERARY_MAX_DAYS,
      message: `An itinerary has at most ${ITINERARY_MAX_DAYS} days`,
    },
  })
  days: ItineraryDay[];

  /** A copy of `days.length`, kept by the service, for the duration filter (ITN-21). */
  @Prop({ required: true, default: 0, min: 0, max: ITINERARY_MAX_DAYS })
  dayCount: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ItineraryModeration),
    default: ItineraryModeration.Visible,
  })
  moderation: ItineraryModeration;

  /** True while the owner's account is deactivated: hides a public itinerary. */
  @Prop({ required: true, default: false })
  authorDeactivated: boolean;

  /** Present only on a clone (ITN-21). */
  @Prop({ type: CloneSourceSchema })
  cloneSource?: CloneSource;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// My itineraries, most recently updated first (ITN-03).
ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
// Public search with the duration filter (ITN-21).
ItinerarySchema.index({
  visibility: 1,
  moderation: 1,
  authorDeactivated: 1,
  dayCount: 1,
});
ItinerarySchema.index({ title: 'text' });
ItinerarySchema.index({ countries: 1 });
ItinerarySchema.index({ 'days.cityId': 1 });
