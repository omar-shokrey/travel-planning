import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { LikeResponseDto } from './dto/like-response.dto';
import { toLikeResponse } from './mappers/like.mapper';
import { BlogPost } from './models/blog-post.schema';
import { Like } from './models/like.schema';
import { PostStatus } from './models/post-status.enum';

/** MongoDB's error code for a value that breaks a unique index. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/** Likes on blog posts (BLG-06). */
@Injectable()
export class LikesService {
  constructor(
    @InjectModel(Like.name)
    private readonly likes: Model<Like>,
    @InjectModel(BlogPost.name)
    private readonly posts: Model<BlogPost>,
  ) {}

  /** BLG-06: the logged-in user likes a published post, once. */
  async like(postId: string, userId: string): Promise<LikeResponseDto> {
    await this.assertPublishedPost(postId);

    try {
      await this.likes.create({
        postId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(userId),
      });
    } catch (error) {
      // The unique (postId, userId) index decides, so a double click or two
      // requests at the same moment can never store two likes.
      if (isDuplicateKey(error)) {
        throw new ConflictException('You have already liked this post');
      }
      throw error;
    }

    const post = await this.posts
      .findOneAndUpdate(
        { _id: postId },
        { $inc: { likeCount: 1 } },
        { returnDocument: 'after' },
      )
      .exec();

    return toLikeResponse(postId, true, post?.likeCount);
  }

  /** BLG-06: the logged-in user removes their like from a post. */
  async unlike(postId: string, userId: string): Promise<LikeResponseDto> {
    await this.assertPublishedPost(postId);

    // Deletes exactly one record: this user's like on this post.
    const { deletedCount } = await this.likes
      .deleteOne({
        postId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (deletedCount === 0) {
      throw new ConflictException('You have not liked this post');
    }

    // Only one of two unlike requests at the same moment deletes the like, so
    // the counter goes down once. The `$gt` guard keeps it from going below 0.
    const post =
      (await this.posts
        .findOneAndUpdate(
          { _id: postId, likeCount: { $gt: 0 } },
          { $inc: { likeCount: -1 } },
          { returnDocument: 'after' },
        )
        .exec()) ?? (await this.posts.findById(postId).exec());

    return toLikeResponse(postId, false, post?.likeCount);
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
