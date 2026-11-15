import type { Types } from 'mongoose';
import type { PostResponseDto } from '../dto/post-response.dto';
import type { BlogPost } from '../models/blog-post.schema';

/** The fields the mapper reads. A post document and a lean post both fit. */
export type PostSource = Pick<
  BlogPost,
  | 'authorId'
  | 'title'
  | 'body'
  | 'status'
  | 'publishedAt'
  | 'tags'
  | 'images'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId };

/** Turns a stored post into what the API returns. */
export function toPostResponse(post: PostSource): PostResponseDto {
  return {
    // `_id`, not the `id` virtual, which a lean post does not have.
    id: post._id.toString(),
    authorId: post.authorId.toString(),
    title: post.title,
    body: post.body,
    status: post.status,
    // Moments leave the API as UTC ISO strings (AGENTS.md).
    publishedAt: post.publishedAt?.toISOString(),
    tags: post.tags,
    images: post.images,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
