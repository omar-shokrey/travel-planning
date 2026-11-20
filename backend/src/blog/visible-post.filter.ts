import { Types, type QueryFilter } from 'mongoose';
import type { BlogPost } from './models/blog-post.schema';
import { PostModeration } from './models/post-moderation.enum';
import { PostStatus } from './models/post-status.enum';

/**
 * The filter for "a post this viewer may see and engage with": published
 * (BLG-01) and not hidden by an admin (GEN-10), except that its author still
 * sees their own hidden post. A guest (no `viewerId`) never sees a hidden
 * post. The post of a deactivated author (ACC-12) is left out for every
 * viewer: its author can no longer log in. `$ne` lets a post stored before
 * `moderation` or `authorDeactivated` existed count as visible. Used by the
 * post page (BLG-02), comments (BLG-05), likes (BLG-06) and reports of a
 * comment (GEN-09), so such a post answers 404 there exactly like a missing
 * one.
 */
export function visiblePublishedPost(
  postId: string,
  viewerId?: string,
): QueryFilter<BlogPost> {
  const notHidden = { moderation: { $ne: PostModeration.Hidden } };
  return {
    _id: postId,
    status: PostStatus.Published,
    authorDeactivated: { $ne: true },
    ...(viewerId
      ? {
          $or: [notHidden, { authorId: new Types.ObjectId(viewerId) }],
        }
      : notHidden),
  };
}
