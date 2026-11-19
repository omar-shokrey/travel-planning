import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type QueryFilter } from 'mongoose';
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
import { PostModeration } from './models/post-moderation.enum';
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
 * the newest posts (BLG-09), both of which BLG-02 can narrow to one tag, and
 * the posts of the author page (BLG-12). It also reads the author names that
 * the lists and the post page (BLG-02) show.
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

  /**
   * BLG-12: the author page's posts, the published, not hidden posts of one
   * author, newest first. The (authorId, status, moderation, publishedAt,
   * _id) index serves it.
   */
  listByAuthor(
    authorId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return this.listNewestMatching(
      { authorId: new Types.ObjectId(authorId) },
      query,
    );
  }

  /**
   * BLG-09 without a keyword: the newest published, not hidden posts. BLG-02:
   * with a `tag`, only the ones that have it, the same posts as `listByTag`.
   */
  listNewest(
    query: PaginationQueryDto,
    tag?: string,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return this.listNewestMatching(
      tag === undefined ? {} : { tags: tag },
      query,
    );
  }

  /**
   * BLG-09: the published posts whose title, tags or author name contain the
   * keyword, ignoring letter case. Ordered by interaction score (likes +
   * comments) descending, then newest first, then by id, so a page never
   * shifts between two reads. The authors are found first by name, then
   * their posts by id: no name is copied into the posts. BLG-02: with a
   * `tag`, a post must also have that tag; both conditions must hold.
   */
  async search(
    keyword: string,
    query: PaginationQueryDto,
    tag?: string,
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
      ...(tag !== undefined && { tags: tag }),
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
   * Which posts the public may see: published ones that an admin has not
   * hidden (GEN-10). `$ne` lets a post stored before `moderation` existed
   * count as visible. A public list does not know who is asking, so a hidden
   * post is left out for its author too; the author still sees it in "my
   * posts" (BLG-03). Hiding the posts of a deactivated author (ACC-12) adds
   * its condition here, and every public list follows.
   */
  publishedFilter(): QueryFilter<BlogPost> {
    return {
      status: PostStatus.Published,
      moderation: { $ne: PostModeration.Hidden },
    };
  }

  /**
   * The posts the public may see (`publishedFilter()`) that also match
   * `filter`, newest first, one page.
   */
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
   * BLG-02: the names that may be shown for these authors, read in one query:
   * author id (as a string) to name. A missing or deactivated author is not in
   * the map, and the mappers show "Deleted user" for it. Used by the lists
   * and by the post page, so they all follow the same rule.
   */
  async authorNamesOf(
    authorIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = [
      ...new Map(authorIds.map((id) => [id.toString(), id])).values(),
    ];
    const authors =
      unique.length === 0
        ? []
        : await this.users
            .find({
              _id: { $in: unique },
              status: { $ne: UserStatus.Deactivated },
            })
            .select('name')
            .lean<{ _id: Types.ObjectId; name: string }[]>()
            .exec();
    return new Map(
      authors.map((author) => [author._id.toString(), author.name]),
    );
  }

  /** The rows of a page, with the author names read in one query. */
  private async toSummaries(
    posts: PostSummarySource[],
  ): Promise<PostSummaryResponseDto[]> {
    const names = await this.authorNamesOf(posts.map((post) => post.authorId));
    return posts.map((post) => toPostSummary(post, names));
  }
}
