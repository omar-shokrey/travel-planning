import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { CommentResponseDto } from './dto/comment-response.dto';
import type { CreateCommentDto } from './dto/create-comment.dto';
import type { UpdateCommentDto } from './dto/update-comment.dto';
import { toCommentResponse } from './mappers/comment.mapper';
import { visiblePublishedPost } from './visible-post.filter';
import { BlogPost } from './models/blog-post.schema';
import { CommentModeration } from './models/comment-moderation.enum';
import { Comment, type CommentDocument } from './models/comment.schema';

/**
 * GEN-10: a hidden comment is left out of the comment list. `$ne`, so a
 * comment stored before `moderation` existed still counts as visible.
 */
const NOT_HIDDEN = { moderation: { $ne: CommentModeration.Hidden } };

/** What other services (reports, GEN-09) read of a comment. */
export interface CommentSummary {
  authorId: string;
  postId: string;
  moderation: CommentModeration;
}

/**
 * Comments on blog posts (BLG-05, BLG-07), and their moderation by an admin
 * (GEN-10). The post's `commentCount` is the number of its visible comments.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private readonly comments: Model<Comment>,
    @InjectModel(BlogPost.name)
    private readonly posts: Model<BlogPost>,
  ) {}

  /** BLG-05: the logged-in user comments on a published post. */
  async create(
    postId: string,
    dto: CreateCommentDto,
    userId: string,
  ): Promise<CommentResponseDto> {
    await this.assertPublishedPost(postId, userId);

    const comment = await this.comments.create({
      postId: new Types.ObjectId(postId),
      authorId: new Types.ObjectId(userId),
      body: dto.body,
    });

    // A new comment is visible, so it counts. One atomic step, so two
    // comments at the same moment both count.
    await this.raiseCommentCount(comment.postId);

    return toCommentResponse(comment);
  }

  /**
   * BLG-05: the comments of a published post, oldest first. A comment an
   * admin hid (GEN-10) is left out for everyone: the route is public, so it
   * does not know who is asking.
   */
  async listForPost(
    postId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    await this.assertPublishedPost(postId);

    const filter = { postId: new Types.ObjectId(postId), ...NOT_HIDDEN };
    const [comments, total] = await Promise.all([
      this.comments
        .find(filter)
        // `_id` breaks the tie between two comments of the same millisecond.
        .sort({ createdAt: 1, _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.comments.countDocuments(filter).exec(),
    ]);

    return paginate(comments.map(toCommentResponse), total, query);
  }

  /** BLG-07: the logged-in user edits the text of their own comment. */
  async update(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<CommentResponseDto> {
    const comment = await this.findOwnCommentOrThrow(
      commentId,
      userId,
      'You can only edit your own comments',
    );

    comment.body = dto.body;
    await comment.save();

    return toCommentResponse(comment);
  }

  /**
   * BLG-07: the logged-in user deletes their own comment, hidden or not. The
   * comment count goes down only for a visible comment: a hidden one was
   * already taken off it when it was hidden (GEN-10).
   */
  async remove(commentId: string, userId: string): Promise<void> {
    const comment = await this.findOwnCommentOrThrow(
      commentId,
      userId,
      'You can only delete your own comments',
    );

    await this.deleteOneAndRecount(comment._id.toString());
  }

  /**
   * For other services (reports, GEN-09): the author, the post and the
   * moderation of a comment, or null when there is no such comment. The
   * caller decides who may see it. Not exposed by a controller.
   */
  async findSummary(commentId: string): Promise<CommentSummary | null> {
    const comment = await this.comments
      .findById(commentId)
      .select('authorId postId moderation')
      .lean()
      .exec();
    if (!comment) {
      return null;
    }
    return {
      authorId: comment.authorId.toString(),
      postId: comment.postId.toString(),
      // A lean comment stored before `moderation` existed has no value.
      moderation: comment.moderation ?? CommentModeration.Visible,
    };
  }

  /**
   * For the admin module (GEN-10): any comment, hidden or not ("hidden
   * content is visible only to its author and admins"); null when there is
   * no such comment. Not exposed by a blog controller.
   */
  async findForAdmin(commentId: string): Promise<CommentResponseDto | null> {
    const comment = await this.comments.findById(commentId).exec();
    return comment ? toCommentResponse(comment) : null;
  }

  /** For the admin module (GEN-10): whether a comment with this id exists. */
  async existsById(commentId: string): Promise<boolean> {
    // A count, not exists(), like PostsService.existsById.
    return (await this.comments.countDocuments({ _id: commentId }).exec()) > 0;
  }

  /**
   * For the admin module (GEN-10): hides a comment, or shows it again. One
   * conditional update, so of two admins at the same moment only one changes
   * it, and only that one changes the post's `commentCount` (-1 on hide, +1 on
   * show). Returns false when nothing changed: the comment is missing or
   * already in that state.
   */
  async setHidden(commentId: string, hidden: boolean): Promise<boolean> {
    const filter = hidden
      ? { _id: commentId, ...NOT_HIDDEN }
      : { _id: commentId, moderation: CommentModeration.Hidden };
    const moderation = hidden
      ? CommentModeration.Hidden
      : CommentModeration.Visible;
    const comment = await this.comments
      // Not an edit by the author, so `updatedAt` ("edited") stays.
      .findOneAndUpdate(filter, { $set: { moderation } }, { timestamps: false })
      .select('postId')
      .lean()
      .exec();
    if (!comment) {
      return false;
    }
    if (hidden) {
      await this.lowerCommentCount(comment.postId);
    } else {
      await this.raiseCommentCount(comment.postId);
    }
    return true;
  }

  /**
   * For the admin module (GEN-10): deletes exactly one comment by id, whoever
   * wrote it, and lowers the post's `commentCount` when it was visible.
   * Returns false when there was no such comment.
   */
  removeByAdmin(commentId: string): Promise<boolean> {
    return this.deleteOneAndRecount(commentId);
  }

  /**
   * Deletes one comment by id. `findOneAndDelete` returns the comment as it
   * was when it was deleted, so of two deletes at the same moment only one
   * gets it, and the count goes down once, and only if it was visible.
   */
  private async deleteOneAndRecount(commentId: string): Promise<boolean> {
    const deleted = await this.comments
      .findByIdAndDelete(commentId)
      .select('postId moderation')
      .lean()
      .exec();
    if (!deleted) {
      return false;
    }
    if (deleted.moderation !== CommentModeration.Hidden) {
      await this.lowerCommentCount(deleted.postId);
    }
    return true;
  }

  /** One atomic `$inc`, so two changes at the same moment both count. */
  private async raiseCommentCount(postId: Types.ObjectId): Promise<void> {
    await this.posts
      .updateOne({ _id: postId }, { $inc: { commentCount: 1 } })
      .exec();
  }

  /** One atomic `$inc`; the `$gt` guard keeps the count from going below 0. */
  private async lowerCommentCount(postId: Types.ObjectId): Promise<void> {
    await this.posts
      .updateOne(
        { _id: postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
      )
      .exec();
  }

  /** 404 when the comment does not exist, 403 when it is someone else's. */
  private async findOwnCommentOrThrow(
    commentId: string,
    userId: string,
    notOwnerMessage: string,
  ): Promise<CommentDocument> {
    const comment = await this.comments.findById(commentId).exec();

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId.toString() !== userId) {
      throw new ForbiddenException(notOwnerMessage);
    }

    return comment;
  }

  /**
   * 404 unless the post is published and not hidden by an admin (GEN-10). A
   * draft answers like a missing post, so nobody learns that it exists. The
   * author still reaches their own hidden post; a guest (no `viewerId`) never
   * does, so a hidden post answers like a missing one.
   */
  private async assertPublishedPost(
    postId: string,
    viewerId?: string,
  ): Promise<void> {
    const post = await this.posts
      .exists(visiblePublishedPost(postId, viewerId))
      .exec();

    if (!post) {
      throw new NotFoundException('Post not found');
    }
  }
}
