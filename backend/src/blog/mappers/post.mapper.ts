import type { Types } from 'mongoose';
import type { MyPostResponseDto } from '../dto/my-post-response.dto';
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
  | 'itineraryId'
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
    // BLG-13: a post stored before the field existed has none.
    itineraryId: post.itineraryId?.toString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/** The fields a "my posts" row reads (BLG-03). */
export type MyPostSource = Pick<
  BlogPost,
  | 'title'
  | 'status'
  | 'moderation'
  | 'publishedAt'
  | 'itineraryId'
  | 'likeCount'
  | 'commentCount'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId };

/** Turns a stored post into one row of "my posts" (BLG-03). */
export function toMyPostResponse(post: MyPostSource): MyPostResponseDto {
  return {
    id: post._id.toString(),
    title: post.title,
    status: post.status,
    // GEN-10: the author still sees a hidden post, and is told it is hidden.
    moderation: post.moderation,
    ...(post.publishedAt && { publishedAt: post.publishedAt.toISOString() }),
    itineraryId: post.itineraryId?.toString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  };
}
