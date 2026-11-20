import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type Types } from 'mongoose';
import { REPLY_TEXT_MAX_LENGTH } from '../hotel-bookings.constants';

/**
 * HTL-26: the hotel moderator's reply to a review, kept on the review
 * (specs/travel-platform.md: "hotel replies to reviews, a field on the
 * review"). One per review. `moderatorId` records who wrote it and never
 * leaves the API.
 */
@Schema({ _id: false })
export class ReviewReply {
  /** Trimmed; never an empty text. */
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: REPLY_TEXT_MAX_LENGTH,
  })
  text: string;

  @Prop({ type: Date, required: true })
  repliedAt: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  moderatorId: Types.ObjectId;
}

export const ReviewReplySchema = SchemaFactory.createForClass(ReviewReply);
