import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import { AuthorsService } from './authors.service';

describe('AuthorsService', () => {
  const users = {
    findOne: jest.fn(),
  };

  const publishedPostsService = {
    findByAuthor: jest.fn(),
  };

  let service: AuthorsService;

  const authorId = new Types.ObjectId();
  const createdAt = new Date('2026-01-15T10:30:00.000Z');

  const query: AuthorPageQueryDto = {
    postsPage: 1,
    postsLimit: 10,
    itinerariesPage: 1,
    itinerariesLimit: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthorsService(
      users as never,
      publishedPostsService as never,
    );
  });

  it('should return the public author page for a valid user', async () => {
    const author = {
      _id: authorId,
      name: 'Salma',
      createdAt,
      role: Role.User,
      status: UserStatus.Active,
    };

    users.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(author),
    });

    publishedPostsService.findByAuthor.mockResolvedValue({
      items: [],
      meta: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    });

    const result = await service.findAuthorPage(authorId, query);

    expect(users.findOne).toHaveBeenCalledWith({
      _id: authorId,
      role: Role.User,
      status: { $ne: UserStatus.Deactivated },
    });

    expect(publishedPostsService.findByAuthor).toHaveBeenCalledWith(
      authorId,
      1,
      10,
    );

    expect(result.id).toBe(authorId.toString());
    expect(result.name).toBe('Salma');
    expect(result.joinedAt).toBe('2026-01-15T10:30:00.000Z');
    expect(result.posts.items).toEqual([]);
  });

  it('should allow suspended authors', async () => {
    const author = {
      _id: authorId,
      name: 'Suspended Author',
      createdAt,
      role: Role.User,
      status: UserStatus.Suspended,
    };

    users.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(author),
    });

    publishedPostsService.findByAuthor.mockResolvedValue({
      items: [],
      meta: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    });

    await expect(
      service.findAuthorPage(authorId, query),
    ).resolves.toBeDefined();
  });

  it('should throw 404 when the author does not exist', async () => {
    users.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.findAuthorPage(authorId, query),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(publishedPostsService.findByAuthor).not.toHaveBeenCalled();
  });

  it('should use the same 404 behavior for an invalid public author', async () => {
    users.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(service.findAuthorPage(authorId, query)).rejects.toThrow(
      'Author not found',
    );
  });
});
