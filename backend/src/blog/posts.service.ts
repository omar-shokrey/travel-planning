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
import { CreatePostDto } from './dto/create-post.dto';
import type { MyPostResponseDto } from './dto/my-post-response.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { BlogPost, type BlogPostDocument } from './models/blog-post.schema';
import { PostStatus } from './models/post-status.enum';
import { toMyPostResponse, toPostResponse } from './mappers/post.mapper';

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(BlogPost.name)
    private readonly posts: Model<BlogPost>,
  ) {}

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
