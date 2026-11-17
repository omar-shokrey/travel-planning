import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserStatus } from '../common/enums/user-status.enum';
import { User } from '../users/models/user.schema';
import type { PostSummaryResponseDto } from './dto/post-summary-response.dto';
import {
  toPostSummary,
  type PostSummarySource,
} from './mappers/post-summary.mapper';
import { BlogPost } from './models/blog-post.schema';
import { PostStatus } from './models/post-status.enum';

/** The fields a list row needs. The body is read only for the excerpt. */
const SUMMARY_FIELDS =
  'authorId title body tags publishedAt likeCount commentCount';

/**
 * The public lists of published posts: the tag page (BLG-08), later the
 * search and the feed (BLG-09, BLG-02). Every list starts from
 * `publishedFilter()`, the one place that says which posts the public may
 * see.
 */
@Injectable()
export class PublishedPostsService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** BLG-08: the published posts that have the tag, newest first. */
  async listByTag(
    tag: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    const filter: QueryFilter<BlogPost> = {
      ...this.publishedFilter(),
      tags: tag,
    };
    const [posts, total] = await Promise.all([
      this.posts
        .find(filter)
        .select(SUMMARY_FIELDS)
        .sort({ publishedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean<PostSummarySource[]>()
        .exec(),
      this.posts.countDocuments(filter).exec(),
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
