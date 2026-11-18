import { NotFoundException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import type { User } from '../users/models/user.schema';
import { AUTHOR_NOT_FOUND, AuthorsService } from './authors.service';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import type { PublishedPostsService } from './published-posts.service';

const authorId = '6740f1c2a4b5c6d7e8f90001';
const emptyPage = (page = 1, limit = 10) => ({
  items: [],
  meta: { page, limit, total: 0, totalPages: 0 },
});

/** A chain like Mongoose's query: every step returns the chain, `exec` resolves. */
interface QueryChain {
  select: jest.Mock<QueryChain>;
  lean: jest.Mock<QueryChain>;
  exec: jest.Mock;
}

function setup(found: unknown) {
  const chain: QueryChain = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(found),
  };
  const users = { findOne: jest.fn(() => chain) };
  const publishedPosts = {
    listByAuthor: jest.fn().mockResolvedValue(emptyPage()),
  };
  const publicItineraries = {
    listByAuthor: jest.fn().mockResolvedValue(emptyPage()),
  };
  const service = new AuthorsService(
    users as unknown as Model<User>,
    publishedPosts as unknown as PublishedPostsService,
    publicItineraries as unknown as PublicItinerariesService,
  );
  return { service, users, chain, publishedPosts, publicItineraries };
}

const query = (fields: Partial<AuthorPageQueryDto> = {}) =>
  Object.assign(new AuthorPageQueryDto(), fields);

describe('AuthorsService (BLG-12)', () => {
  const author = {
    _id: new Types.ObjectId(authorId),
    name: 'Sara Ahmed',
    createdAt: new Date('2026-03-02T09:15:00.000Z'),
  };

  it('looks for an active or suspended registered user only, reading the name and join date', async () => {
    const { service, users, chain } = setup(author);

    await service.findPage(authorId, query());

    expect(users.findOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(authorId),
      role: Role.User,
      status: { $ne: UserStatus.Deactivated },
    });
    expect(chain.select).toHaveBeenCalledWith('name createdAt');
  });

  it('answers 404 "Author not found" when no such author has a page', async () => {
    // An unknown id, an admin, a moderator and a deactivated account all
    // fail the same filter above, so they all get this one answer.
    const { service, publishedPosts, publicItineraries } = setup(null);

    await expect(service.findPage(authorId, query())).rejects.toThrow(
      new NotFoundException(AUTHOR_NOT_FOUND),
    );
    expect(publishedPosts.listByAuthor).not.toHaveBeenCalled();
    expect(publicItineraries.listByAuthor).not.toHaveBeenCalled();
  });

  it('reads each list with its own page', async () => {
    const { service, publishedPosts, publicItineraries } = setup(author);

    await service.findPage(
      authorId,
      query({
        postsPage: 2,
        postsLimit: 5,
        itinerariesPage: 3,
        itinerariesLimit: 7,
      }),
    );

    expect(publishedPosts.listByAuthor).toHaveBeenCalledWith(
      authorId,
      expect.objectContaining({ page: 2, limit: 5, skip: 5 }),
    );
    expect(publicItineraries.listByAuthor).toHaveBeenCalledWith(
      authorId,
      expect.objectContaining({ page: 3, limit: 7, skip: 14 }),
    );
  });

  it('returns the mapped page', async () => {
    const { service, publishedPosts, publicItineraries } = setup(author);
    const posts = {
      items: [{ id: 'p1' }],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    };
    publishedPosts.listByAuthor.mockResolvedValue(posts);
    publicItineraries.listByAuthor.mockResolvedValue(emptyPage());

    await expect(service.findPage(authorId, query())).resolves.toEqual({
      id: authorId,
      name: 'Sara Ahmed',
      joinedAt: '2026-03-02T09:15:00.000Z',
      posts,
      itineraries: emptyPage(),
    });
  });
});
