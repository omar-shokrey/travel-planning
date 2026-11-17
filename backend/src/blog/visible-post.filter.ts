import { Types, type QueryFilter } from 'mongoose';
import type { BlogPost } from './models/blog-post.schema';
import { PostModeration } from './models/post-moderation.enum';
import { PostStatus } from './models/post-status.enum';

/**
 * The filter for "a post this viewer may see and engage with": published
 * (BLG-01) and not hidden by an admin (GEN-10), except that its author still
 * sees their own hidden post. A guest (no `viewerId`) never sees a hidden
 * post. `$ne` lets a post stored before `moderation` existed count as
 * visible. Used by comments (BLG-05) and likes (BLG-06), so a hidden post
 * answers 404 there exactly like a missing one.
 */
export function visiblePublishedPost(
  postId: string,
  viewerId?: string,
): QueryFilter<BlogPost> {
  const notHidden = { moderation: { $ne: PostModeration.Hidden } };
  return {
    _id: postId,
    status: PostStatus.Published,
    ...(viewerId
      ? {
          $or: [notHidden, { authorId: new Types.ObjectId(viewerId) }],
        }
      : notHidden),
  };
}
