import type { Types } from 'mongoose';
import type { ReviewResponseDto } from '../dto/review-response.dto';
import type { Review } from '../models/review.schema';

export type ReviewSource = Review & { _id: Types.ObjectId };

/**
 * A review as the API returns it (HTL-23, HTL-24). The author is shown by
 * name; the author's account id and the moderation state stay inside.
 */
export function toReviewResponse(
  review: ReviewSource,
  authorName: string | null,
): ReviewResponseDto {
  return {
    id: review._id.toString(),
    hotelId: review.hotelId.toString(),
    bookingId: review.bookingId.toString(),
    rating: review.rating,
    text: review.text ?? null,
    authorName,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}
