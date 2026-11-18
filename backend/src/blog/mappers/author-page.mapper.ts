import type { Types } from 'mongoose';
import type { PaginatedResponse } from '../../common/dto/paginated-response.dto';
import type { PublicItineraryResponseDto } from '../../itineraries/dto/public-itinerary-response.dto';
import type { AuthorPageResponseDto } from '../dto/author-page-response.dto';
import type { PostSummaryResponseDto } from '../dto/post-summary-response.dto';

/** The only account fields the author page reads. */
export interface AuthorPageSource {
  _id: Types.ObjectId;
  name: string;
  createdAt: Date;
}

/**
 * BLG-12: the public page of an author. Every field is named here, so nothing
 * else of the account (email, phone, role, status, currency, password data)
 * can reach the answer, even if the source carries it.
 */
export function toAuthorPage(
  author: AuthorPageSource,
  posts: PaginatedResponse<PostSummaryResponseDto>,
  itineraries: PaginatedResponse<PublicItineraryResponseDto>,
): AuthorPageResponseDto {
  return {
    id: author._id.toString(),
    name: author.name,
    joinedAt: author.createdAt.toISOString(),
    posts: { items: posts.items, meta: posts.meta },
    itineraries: { items: itineraries.items, meta: itineraries.meta },
  };
}
