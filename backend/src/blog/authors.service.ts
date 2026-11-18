import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { User } from '../users/models/user.schema';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import { AuthorPageResponseDto } from './dto/author-page-response.dto';
import { PublishedPostsService } from './services/published-posts.service';

interface AuthorRecord {
  _id: Types.ObjectId;
  name: string;
  createdAt: Date;
}

@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(User.name)
    private readonly users: Model<User>,
    private readonly publishedPostsService: PublishedPostsService,
  ) {}

  async findAuthorPage(
    authorId: Types.ObjectId,
    query: AuthorPageQueryDto,
  ): Promise<AuthorPageResponseDto> {
    const author = await this.users
      .findOne({
        _id: authorId,
        role: Role.User,
        status: { $ne: UserStatus.Deactivated },
      })
      .lean<AuthorRecord>();

    if (!author) {
      throw new NotFoundException('Author not found');
    }

    const posts = await this.publishedPostsService.findByAuthor(
      authorId,
      query.postsPage,
      query.postsLimit,
    );

    return {
      id: author._id.toString(),
      name: author.name,
      joinedAt: author.createdAt.toISOString(),
      posts,
      itineraries: {
        items: [],
        meta: {
          page: query.itinerariesPage,
          limit: query.itinerariesLimit,
          total: 0,
          totalPages: 0,
        },
      },
    };
  }
}
