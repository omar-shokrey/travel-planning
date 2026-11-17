import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { ReviewModeration } from '../enums/review-moderation.enum';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX_LENGTH,
} from '../hotel-bookings.constants';

/**
 * One rating, with an optional text, for one completed reservation (HTL-23).
 * It follows the `REVIEW` entity of the data model in
 * `specs/travel-platform.md`.
 */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** The author: the user who made the reservation. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** One review per reservation, whatever the number of rooms. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'HotelBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: REVIEW_RATING_MIN,
    max: REVIEW_RATING_MAX,
    validate: {
      validator: Number.isInteger,
      message: 'The rating must be a whole number',
    },
  })
  rating: number;

  @Prop({ type: String, trim: true, maxlength: REVIEW_TEXT_MAX_LENGTH })
  text?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReviewModeration),
    default: ReviewModeration.Visible,
  })
  moderation: ReviewModeration;

  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per reservation (HTL-23).
ReviewSchema.index({ bookingId: 1 }, { unique: true });
// The reviews of a hotel, newest first (HTL-24).
ReviewSchema.index({ hotelId: 1, createdAt: -1 });
