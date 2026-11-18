import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreatePostDto } from './dto/create-post.dto';
import type { MyPostResponseDto } from './dto/my-post-response.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { BlogPost, type BlogPostDocument } from './models/blog-post.schema';
import { Comment } from './models/comment.schema';
import { Like } from './models/like.schema';
import { PostStatus } from './models/post-status.enum';
import { toMyPostResponse, toPostResponse } from './mappers/post.mapper';
import { PostModeration } from './models/post-moderation.enum';
import { visiblePublishedPost } from './visible-post.filter';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectModel(BlogPost.name)
    private readonly posts: Model<BlogPost>,
    @InjectModel(Comment.name)
    private readonly comments: Model<Comment>,
    @InjectModel(Like.name)
    private readonly likes: Model<Like>,
  ) {}

  /**
   * For other services (reports, GEN-09): the author id and the moderation of
   * a published post, or null when the post is missing or a draft, so a draft
   * is never revealed to anyone but its author. The caller hides a hidden post
   * from everyone but its author (GEN-10). Not exposed by a controller.
   *
   * Posts have no author-deactivated field yet. When ACC-12 (the author
   * closes the account) adds one, return it too, so the caller leaves those
   * posts out for everyone but the author, as reports already do for
   * itineraries; otherwise reporting such a post answers 201 instead of 404.
   */
  async findPublishedSummary(
    postId: string,
  ): Promise<{ authorId: string; moderation: PostModeration } | null> {
    const post = await this.posts
      .findOne({ _id: postId, status: PostStatus.Published })
      .select('authorId moderation')
      .lean()
      .exec();
    if (!post) {
      return null;
    }
    return {
      authorId: post.authorId.toString(),
      // A lean post stored before `moderation` existed has no value: visible.
      moderation: post.moderation ?? PostModeration.Visible,
    };
  }

  /**
   * For other services (reports of a comment, GEN-09): whether this viewer
   * may see the post, by the same rule as comments and likes
   * (`visiblePublishedPost`): published, and not hidden unless the viewer is
   * its author. Not exposed by a controller.
   */
  async isVisibleTo(postId: string, viewerId: string): Promise<boolean> {
    // A count, not exists(), like existsById below.
    const count = await this.posts
      .countDocuments(visiblePublishedPost(postId, viewerId))
      .exec();
    return count > 0;
  }

  /**
   * For the admin module (GEN-10): any post, draft or published, hidden or
   * not ("hidden content is visible only to its author and admins"), and
   * whether an admin hid it; null when there is no such post. Not exposed by
   * a blog controller.
   */
  async findForAdmin(
    postId: string,
  ): Promise<{ post: PostResponseDto; hidden: boolean } | null> {
    const post = await this.posts.findById(postId).exec();
    if (!post) {
      return null;
    }
    return {
      post: toPostResponse(post),
      hidden: post.moderation === PostModeration.Hidden,
    };
  }

  /** For the admin module (GEN-10): whether a post with this id exists. */
  async existsById(postId: string): Promise<boolean> {
    // A count, not exists(): a findOne that matched stalled in local e2e runs
    // against the Atlas test database.
    return (await this.posts.countDocuments({ _id: postId }).exec()) > 0;
  }

  /**
   * For the admin module (GEN-10): hides a post, or shows it again. One
   * conditional update, so of two admins at the same moment only one changes
   * it. Returns false when nothing changed: the post is missing or already in
   * that state (a post stored before `moderation` existed counts as visible).
   */
  async setHidden(postId: string, hidden: boolean): Promise<boolean> {
    const filter = hidden
      ? { _id: postId, moderation: { $ne: PostModeration.Hidden } }
      : { _id: postId, moderation: PostModeration.Hidden };
    const moderation = hidden ? PostModeration.Hidden : PostModeration.Visible;
    const post = await this.posts
      // Not an edit by the owner, so `updatedAt` ("last changed") stays.
      .findOneAndUpdate(filter, { $set: { moderation } }, { timestamps: false })
      .select('_id')
      .lean()
      .exec();
    return post !== null;
  }

  /**
   * For the admin module (GEN-10): deletes a post, whoever wrote it. Returns
   * the file names of its images, which the caller deletes, or null when
   * there was no such post.
   */
  async removeByAdmin(postId: string): Promise<string[] | null> {
    const post = await this.posts
      .findByIdAndDelete(postId)
      .select('images')
      .lean()
      .exec();
    if (!post) {
      return null;
    }
    // The post is already deleted, so a failure here is logged, not answered
    // as a 500: a retry would answer 404, and the images would never be
    // removed. The comments and likes left behind point at a missing post,
    // which every comment and like route already answers with 404.
    try {
      await this.removeEngagementOfPost(postId);
    } catch (error) {
      this.logger.error(
        `Deleting the comments and likes of deleted post ${postId} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return [...(post.images ?? [])];
  }

  /**
   * Deletes the comments (BLG-05) and likes (BLG-06) of a post that was just
   * deleted, so none are left pointing at it. For every post delete: the
   * admin's (GEN-10) and the author's own (BLG-04). Each filter names that one
   * post, never a broad set. Returns how many of each were deleted.
   */
  async removeEngagementOfPost(
    postId: string,
  ): Promise<{ comments: number; likes: number }> {
    const filter = { postId: new Types.ObjectId(postId) };
    const [comments, likes] = await Promise.all([
      this.comments.deleteMany(filter).exec(),
      this.likes.deleteMany(filter).exec(),
    ]);
    return { comments: comments.deletedCount, likes: likes.deletedCount };
  }

  async create(dto: CreatePostDto, userId: string): Promise<PostResponseDto> {
    const post = await this.posts.create({
      ...dto,
      authorId: new Types.ObjectId(userId),
      publishedAt: dto.status === PostStatus.Published ? new Date() : undefined,
    });

    return toPostResponse(post);
  }

  /**
   * The posts of the logged-in user, drafts included, newest first (BLG-03).
   * The filter is the author id from the login, so nobody sees the drafts of
   * someone else. Documents are hydrated, not lean, so the counter defaults
   * apply to posts stored before the counters existed.
   */
  async listMine(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<MyPostResponseDto>> {
    const filter = { authorId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    return paginate(items.map(toMyPostResponse), total, query);
  }

  /** BLG-04: edit your own blog post. */
  async update(
    id: string,
    dto: UpdatePostDto,
    userId: string,
  ): Promise<PostResponseDto> {
    const post = await this.findOwnedOrThrow(id, userId);

    if (dto.title !== undefined) {
      post.title = dto.title;
    }

    if (dto.body !== undefined) {
      post.body = dto.body;
    }

    // BLG-08: the tags sent replace the old ones; [] clears them.
    if (dto.tags !== undefined) {
      post.tags = dto.tags;
    }

    if (dto.status !== undefined) {
      post.status = dto.status;

      if (dto.status === PostStatus.Published) {
        post.publishedAt ??= new Date();
      } else {
        post.publishedAt = undefined;
      }
    }

    await post.save();
    return toPostResponse(post);
  }

  /** BLG-04: delete your own blog post. */
  async remove(id: string, userId: string): Promise<void> {
    const post = await this.findOwnedOrThrow(id, userId);
    await post.deleteOne();

    try {
      await this.removeEngagementOfPost(id);
    } catch (error) {
      this.logger.error(
        `Deleting the comments and likes of deleted post ${id} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * BLG-04: loads a post and checks that the caller owns it.
   * Missing post -> 404; another user's post -> 403.
   */
  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<BlogPostDocument> {
    const post = await this.posts.findById(id);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId.toString() !== userId) {
      throw new ForbiddenException('You can only change your own posts');
    }

    return post;
  }
}
