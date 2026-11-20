import type { HotelReviewResponseDto } from '../dto/hotel-review-response.dto';
import type { HotelReviewRecord } from '../hotel-review-lookup.service';
import { DELETED_AUTHOR_NAME } from '../hotels.constants';

/**
 * HTL-24: a review as the public list shows it. `authorNames` maps an
 * account id to the name that may be shown; an author not in it is shown as
 * "Deleted user" (ACC-12). `text` is only set when the review has one, and
 * `reply` (HTL-26) only when the hotel replied.
 */
export function toHotelReviewResponse(
  review: HotelReviewRecord,
  authorNames: ReadonlyMap<string, string>,
): HotelReviewResponseDto {
  return {
    id: review._id.toString(),
    rating: review.rating,
    ...(review.text ? { text: review.text } : {}),
    authorName:
      authorNames.get(review.userId.toString()) ?? DELETED_AUTHOR_NAME,
    ...(review.reply
      ? {
          reply: {
            text: review.reply.text,
            repliedAt: review.reply.repliedAt.toISOString(),
          },
        }
      : {}),
    createdAt: review.createdAt.toISOString(),
  };
}
