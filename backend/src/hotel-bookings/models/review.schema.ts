import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { ReviewModeration } from '../enums/review-moderation.enum';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX_LENGTH,
} from '../hotel-bookings.constants';
import { ReviewReply, ReviewReplySchema } from './review-reply.schema';

/**
 * HTL-23: one rating, with an optional text, of a completed hotel
 * reservation. It follows `REVIEW` of the data model in
 * `specs/travel-platform.md`. The unique `bookingId` makes it one review per
 * reservation, whatever the number of rooms. HTL-26 adds the moderator's
 * optional `reply`.
 */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'HotelBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: REVIEW_RATING_MIN,
    max: REVIEW_RATING_MAX,
    validate: {
      validator: (value: number) => Number.isInteger(value),
      message: 'rating must be a whole number',
    },
  })
  rating: number;

  /** Optional. Trimmed; never an empty text. */
  @Prop({ type: String, trim: true, maxlength: REVIEW_TEXT_MAX_LENGTH })
  text?: string;

  @Prop({
    type: String,
    enum: Object.values(ReviewModeration),
    required: true,
    default: ReviewModeration.Visible,
  })
  moderation: ReviewModeration;

  /** HTL-26: the hotel moderator's reply, once there is one. */
  @Prop({ type: ReviewReplySchema })
  reply?: ReviewReply;

  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per reservation (HTL-23), whatever the number of rooms.
ReviewSchema.index({ bookingId: 1 }, { unique: true });
// The reviews of a hotel, newest first (HTL-24), and the rating aggregation.
ReviewSchema.index({ hotelId: 1, createdAt: -1 });
