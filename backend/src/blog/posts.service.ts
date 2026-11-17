import { Injectable } from '@nestjs/common';
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
import { BlogPost } from './models/blog-post.schema';
import { Comment } from './models/comment.schema';
import { Like } from './models/like.schema';
import { PostStatus } from './models/post-status.enum';
import { toMyPostResponse, toPostResponse } from './mappers/post.mapper';
import { PostModeration } from './models/post-moderation.enum';

@Injectable()
export class PostsService {
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
    await this.removeEngagementOfPost(postId);
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
}
