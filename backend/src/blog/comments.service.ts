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
import { Comment, type CommentDocument } from './models/comment.schema';

/** Comments on blog posts (BLG-05, BLG-07). */
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

    // One atomic step, so two comments at the same moment both count.
    await this.posts
      .updateOne({ _id: comment.postId }, { $inc: { commentCount: 1 } })
      .exec();

    return toCommentResponse(comment);
  }

  /** BLG-05: the comments of a published post, oldest first. */
  async listForPost(
    postId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    await this.assertPublishedPost(postId);

    const filter = { postId: new Types.ObjectId(postId) };
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

  /** BLG-07: the logged-in user deletes their own comment. */
  async remove(commentId: string, userId: string): Promise<void> {
    const comment = await this.findOwnCommentOrThrow(
      commentId,
      userId,
      'You can only delete your own comments',
    );

    // Deletes exactly one record, by id.
    const { deletedCount } = await this.comments
      .deleteOne({ _id: comment._id })
      .exec();

    // Of two delete requests at the same moment only one removes the comment,
    // so the counter goes down once. The `$gt` guard keeps it from going below 0.
    if (deletedCount === 1) {
      await this.posts
        .updateOne(
          { _id: comment.postId, commentCount: { $gt: 0 } },
          { $inc: { commentCount: -1 } },
        )
        .exec();
    }
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
   * A draft is private to its author, so for everyone else it does not exist:
   * a missing post and a draft both answer 404.
   */
  /**
   * 404 unless the post is published and not hidden by an admin (GEN-10);
   * its author still reaches their own hidden post. A guest (no `viewerId`)
   * never does, so a hidden post answers exactly like a missing one.
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
