import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { User } from '../users/models/user.schema';
import { SEARCH_AUTHORS_MAX_COUNT } from './blog.constants';
import type { PostSummaryResponseDto } from './dto/post-summary-response.dto';
import {
  toPostSummary,
  type PostSummarySource,
} from './mappers/post-summary.mapper';
import { BlogPost } from './models/blog-post.schema';
import { PostStatus } from './models/post-status.enum';
import { containsKeyword } from './search-pattern';

/** The fields a list row needs. The body is read only for the excerpt. */
const SUMMARY_FIELD_NAMES = [
  'authorId',
  'title',
  'body',
  'tags',
  'publishedAt',
  'likeCount',
  'commentCount',
] as const;
const SUMMARY_FIELDS = SUMMARY_FIELD_NAMES.join(' ');
const SUMMARY_PROJECTION = Object.fromEntries(
  SUMMARY_FIELD_NAMES.map((field) => [field, 1]),
);

/**
 * The public lists of published posts: the tag page (BLG-08), the search and
 * the newest posts (BLG-09; the browse page, BLG-02, extends the latter).
 * Every list starts from `publishedFilter()`, the one place that says which
 * posts the public may see.
 */
@Injectable()
export class PublishedPostsService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** BLG-08: the published posts that have the tag, newest first. */
  listByTag(
    tag: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return this.listNewestMatching({ tags: tag }, query);
  }

  /** BLG-09 without a keyword: the newest published posts. */
  listNewest(
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return this.listNewestMatching({}, query);
  }

  /**
   * BLG-09: the published posts whose title, tags or author name contain the
   * keyword, ignoring letter case. Ordered by interaction score (likes +
   * comments) descending, then newest first, then by id, so a page never
   * shifts between two reads. The authors are found first by name, then
   * their posts by id: no name is copied into the posts.
   */
  async search(
    keyword: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    const pattern = containsKeyword(keyword);
    const authors = await this.users
      .find({
        role: Role.User,
        status: { $ne: UserStatus.Deactivated },
        name: pattern,
      })
      .select('_id')
      // A fixed order, so the same authors are read for every page.
      .sort({ _id: 1 })
      .limit(SEARCH_AUTHORS_MAX_COUNT)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const match: QueryFilter<BlogPost> = {
      ...this.publishedFilter(),
      $or: [
        { title: pattern },
        { tags: pattern },
        ...(authors.length > 0
          ? [{ authorId: { $in: authors.map((author) => author._id) } }]
          : []),
      ],
    };
    const [posts, total] = await Promise.all([
      this.posts
        .aggregate<PostSummarySource>([
          { $match: match },
          {
            $addFields: {
              score: {
                $add: [
                  { $ifNull: ['$likeCount', 0] },
                  { $ifNull: ['$commentCount', 0] },
                ],
              },
            },
          },
          { $sort: { score: -1, publishedAt: -1, _id: -1 } },
          { $skip: query.skip },
          { $limit: query.limit },
          { $project: SUMMARY_PROJECTION },
        ])
        .exec(),
      this.posts.countDocuments(match).exec(),
    ]);
    return paginate(await this.toSummaries(posts), total, query);
  }

  /**
   * Which posts the public may see. Today: published ones. Hiding by a
   * moderator (GEN-10) and by a deactivated author (ACC-12) add their
   * conditions here, and every public list follows.
   */
  private publishedFilter(): QueryFilter<BlogPost> {
    return { status: PostStatus.Published };
  }

  /** The published posts that also match `filter`, newest first, one page. */
  private async listNewestMatching(
    filter: QueryFilter<BlogPost>,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    const match: QueryFilter<BlogPost> = {
      ...this.publishedFilter(),
      ...filter,
    };
    const [posts, total] = await Promise.all([
      this.posts
        .find(match)
        .select(SUMMARY_FIELDS)
        .sort({ publishedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean<PostSummarySource[]>()
        .exec(),
      this.posts.countDocuments(match).exec(),
    ]);
    return paginate(await this.toSummaries(posts), total, query);
  }

  /**
   * The rows of a page, with the author names read in one query by the set
   * of author ids. A missing or deactivated author is shown as "Deleted user".
   */
  private async toSummaries(
    posts: PostSummarySource[],
  ): Promise<PostSummaryResponseDto[]> {
    const authorIds = [
      ...new Map(
        posts.map((post) => [post.authorId.toString(), post.authorId]),
      ).values(),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await this.users
            .find({
              _id: { $in: authorIds },
              status: { $ne: UserStatus.Deactivated },
            })
            .select('name')
            .lean<{ _id: Types.ObjectId; name: string }[]>()
            .exec();
    const names = new Map(
      authors.map((author) => [author._id.toString(), author.name]),
    );
    return posts.map((post) => toPostSummary(post, names));
  }
}
