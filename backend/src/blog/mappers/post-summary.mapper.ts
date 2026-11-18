import type { Types } from 'mongoose';
import { DELETED_USER_NAME, POST_EXCERPT_LENGTH } from '../blog.constants';
import type { PostSummaryResponseDto } from '../dto/post-summary-response.dto';
import type { BlogPost } from '../models/blog-post.schema';

/** The fields a list row reads. A lean post fits; the counters may be missing on old posts. */
export type PostSummarySource = Pick<
  BlogPost,
  'authorId' | 'title' | 'body' | 'tags'
> &
  Partial<Pick<BlogPost, 'likeCount' | 'commentCount'>> & {
    _id: Types.ObjectId;
    /** Always set: only published posts are listed. */
    publishedAt: Date;
  };

/**
 * The start of a body for a list row: line breaks and runs of spaces become
 * one space, then at most `POST_EXCERPT_LENGTH` characters, cut at the last
 * space so no word is broken, with "…" when something was cut.
 */
export function toExcerpt(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= POST_EXCERPT_LENGTH) {
    return text;
  }
  const head = text.slice(0, POST_EXCERPT_LENGTH);
  // A space right after the limit means the last word is whole.
  if (text[POST_EXCERPT_LENGTH] === ' ') {
    return `${head}…`;
  }
  const lastSpace = head.lastIndexOf(' ');
  // One long word: cut it at the limit, by code point so no emoji is split.
  const cut =
    lastSpace > 0
      ? head.slice(0, lastSpace)
      : [...text].slice(0, POST_EXCERPT_LENGTH).join('');
  return `${cut}…`;
}

/**
 * Turns a published post into one row of a public list (BLG-08, BLG-09).
 * `authorNames` maps the author ids to the names that may be shown; an
 * author not in it is shown as "Deleted user".
 */
export function toPostSummary(
  post: PostSummarySource,
  authorNames: ReadonlyMap<string, string>,
): PostSummaryResponseDto {
  const authorId = post.authorId.toString();
  return {
    id: post._id.toString(),
    title: post.title,
    author: {
      id: authorId,
      name: authorNames.get(authorId) ?? DELETED_USER_NAME,
    },
    publishedAt: post.publishedAt.toISOString(),
    excerpt: toExcerpt(post.body),
    tags: [...post.tags],
    likeCount: post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
  };
}
