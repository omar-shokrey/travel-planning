import type { Types } from 'mongoose';
import type { ReviewResponseDto } from '../dto/review-response.dto';
import type { Review } from '../models/review.schema';

export type ReviewSource = Review & { _id: Types.ObjectId };

/**
 * HTL-23: a review as its author sees it, with the hotel's reply (HTL-26) or
 * `null`. The author's id, the moderation flag and the moderator's id stay
 * inside.
 */
export function toReviewResponse(review: ReviewSource): ReviewResponseDto {
  return {
    id: review._id.toString(),
    hotelId: review.hotelId.toString(),
    bookingId: review.bookingId.toString(),
    rating: review.rating,
    text: review.text ?? null,
    reply: review.reply
      ? {
          text: review.reply.text,
          repliedAt: review.reply.repliedAt.toISOString(),
        }
      : null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}
