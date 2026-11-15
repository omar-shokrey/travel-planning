import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { CommentResponseDto } from './dto/comment-response.dto';
import type { CreateCommentDto } from './dto/create-comment.dto';
import { toCommentResponse } from './mappers/comment.mapper';
import { BlogPost } from './models/blog-post.schema';
import { Comment } from './models/comment.schema';
import { PostStatus } from './models/post-status.enum';

/** Comments on blog posts (BLG-05). */
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
    await this.assertPublishedPost(postId);

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

  /**
   * A draft is private to its author, so for everyone else it does not exist:
   * a missing post and a draft both answer 404.
   */
  private async assertPublishedPost(postId: string): Promise<void> {
    const post = await this.posts
      .exists({ _id: postId, status: PostStatus.Published })
      .exec();

    if (!post) {
      throw new NotFoundException('Post not found');
    }
  }
}
