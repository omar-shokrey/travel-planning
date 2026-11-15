import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePostDto } from './dto/create-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { BlogPost, BlogPostDocument } from './models/blog-post.schema';
import { toPostResponse } from './mappers/post.mapper';

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
    });

    return toPostResponse(post as BlogPostDocument);
  }
}
