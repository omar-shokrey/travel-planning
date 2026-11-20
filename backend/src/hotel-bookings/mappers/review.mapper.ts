import type { Types } from 'mongoose';
import type { ReviewResponseDto } from '../dto/review-response.dto';
import type { Review } from '../models/review.schema';

export type ReviewSource = Review & { _id: Types.ObjectId };

/** HTL-23: a review as its author sees it. The author's id and the moderation flag stay inside. */
export function toReviewResponse(review: ReviewSource): ReviewResponseDto {
  return {
    id: review._id.toString(),
    hotelId: review.hotelId.toString(),
    bookingId: review.bookingId.toString(),
    rating: review.rating,
    text: review.text ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}
