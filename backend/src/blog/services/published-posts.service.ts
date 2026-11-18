import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../../common/dto/paginated-response.dto';
import { PostSummaryResponseDto } from '../dto/post-summary-response.dto';
import { BlogPost } from '../models/blog-post.schema';

@Injectable()
export class PublishedPostsService {
  constructor(
    @InjectModel(BlogPost.name)
    private readonly posts: Model<BlogPost>,
  ) {}

  publishedFilter() {
    return {
      status: 'published',
      moderation: 'visible',
      authorDeactivated: false,
      publishedAt: { $exists: true },
    };
  }

  async findByAuthor(
    authorId: Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    const filter = {
      ...this.publishedFilter(),
      authorId,
    };

    const [posts, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ publishedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.posts.countDocuments(filter),
    ]);

    const items: PostSummaryResponseDto[] = posts.map((post) => ({
      id: post._id.toString(),
      authorId: post.authorId.toString(),
      title: post.title,
      publishedAt: post.publishedAt!.toISOString(),
    }));

    return paginate(items, total, { page, limit });
  }
}
