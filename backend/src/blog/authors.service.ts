import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { User } from '../users/models/user.schema';
import type { AuthorPageQueryDto } from './dto/author-page-query.dto';
import type { AuthorPageResponseDto } from './dto/author-page-response.dto';
import {
  toAuthorPage,
  type AuthorPageSource,
} from './mappers/author-page.mapper';
import { PublishedPostsService } from './published-posts.service';

/** The one answer for every account that has no public page. */
export const AUTHOR_NOT_FOUND = 'Author not found';

/** BLG-12: the public author page. */
@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly publishedPosts: PublishedPostsService,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  /**
   * The author's name, join date, published posts and public itineraries.
   * Only a registered user (role `user`) whose account is not deactivated
   * (ACC-12) has a page; a suspended author keeps theirs. An unknown id, an
   * admin, a moderator and a deactivated author all answer the same 404, so
   * the page reveals no account.
   */
  async findPage(
    id: string,
    query: AuthorPageQueryDto,
  ): Promise<AuthorPageResponseDto> {
    const author = await this.users
      .findOne({
        _id: new Types.ObjectId(id),
        role: Role.User,
        status: { $ne: UserStatus.Deactivated },
      })
      .select('name createdAt')
      .lean<AuthorPageSource>()
      .exec();
    if (!author) {
      throw new NotFoundException(AUTHOR_NOT_FOUND);
    }

    const [posts, itineraries] = await Promise.all([
      this.publishedPosts.listByAuthor(id, query.postsPagination()),
      this.publicItineraries.listByAuthor(id, query.itinerariesPagination()),
    ]);
    return toAuthorPage(author, posts, itineraries);
  }
}
