import type { Types } from 'mongoose';
import { paginate } from '../../common/dto/paginated-response.dto';
import { DELETED_USER_NAME } from '../blog.constants';
import type { PostAuthorResponseDto } from '../dto/post-summary-response.dto';
import type {
  PostCommentResponseDto,
  PostPageResponseDto,
} from '../dto/post-page-response.dto';
import type { BlogPost } from '../models/blog-post.schema';
import type { Comment } from '../models/comment.schema';

/**
 * The fields the post page reads of a post. A lean post fits. A lean read
 * applies no schema default, so the lists and the counters may be missing on
 * a post stored before those fields existed.
 */
export type PostPageSource = Pick<BlogPost, 'authorId' | 'title' | 'body'> &
  Partial<Pick<BlogPost, 'tags' | 'images' | 'likeCount' | 'commentCount'>> & {
    _id: Types.ObjectId;
    /** Always set: only published posts have a page. */
    publishedAt: Date;
  };

/** The fields the post page reads of a comment. A comment document fits. */
export type PostCommentSource = Pick<
  Comment,
  'authorId' | 'body' | 'createdAt' | 'updatedAt'
> & {
  _id: Types.ObjectId;
};

/** The author as shown on the page: "Deleted user" when no name may be shown. */
function toAuthor(
  authorId: Types.ObjectId,
  authorNames: ReadonlyMap<string, string>,
): PostAuthorResponseDto {
  const id = authorId.toString();
  return { id, name: authorNames.get(id) ?? DELETED_USER_NAME };
}

function toPostComment(
  comment: PostCommentSource,
  authorNames: ReadonlyMap<string, string>,
): PostCommentResponseDto {
  return {
    id: comment._id.toString(),
    author: toAuthor(comment.authorId, authorNames),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

/**
 * BLG-02: the public page of a published post. Every field is named here, so
 * nothing else of the post or of its comments (status, moderation, the
 * author id outside `author`, the post ids on the comments) can reach the
 * answer, even if the source carries it. `authorNames` maps author ids to the
 * names that may be shown (post author and comment authors); an author not in
 * it is shown as "Deleted user".
 */
export function toPostPage(
  post: PostPageSource,
  comments: readonly PostCommentSource[],
  commentsTotal: number,
  pagination: { page: number; limit: number },
  authorNames: ReadonlyMap<string, string>,
): PostPageResponseDto {
  return {
    id: post._id.toString(),
    title: post.title,
    author: toAuthor(post.authorId, authorNames),
    publishedAt: post.publishedAt.toISOString(),
    body: post.body,
    tags: [...(post.tags ?? [])],
    images: [...(post.images ?? [])],
    likeCount: post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    comments: paginate(
      comments.map((comment) => toPostComment(comment, authorNames)),
      commentsTotal,
      pagination,
    ),
  };
}
