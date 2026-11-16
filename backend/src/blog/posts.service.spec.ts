import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

describe('PostsService', () => {
  describe('findPublishedAuthorId (GEN-09)', () => {
    const lookup = (found: unknown) => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(found),
      };
      const posts = { findOne: jest.fn().mockReturnValue(query) };
      return { service: new PostsService(posts as never), posts, query };
    };

    it('returns the author id of a published post', async () => {
      const { service, posts, query } = lookup({
        authorId: { toString: () => '507f1f77bcf86cd799439011' },
      });

      expect(await service.findPublishedAuthorId('post-1')).toBe(
        '507f1f77bcf86cd799439011',
      );
      expect(posts.findOne).toHaveBeenCalledWith({
        _id: 'post-1',
        status: PostStatus.Published,
      });
      expect(query.select).toHaveBeenCalledWith('authorId');
    });

    it('returns null for a missing post or a draft', async () => {
      const { service } = lookup(null);

      expect(await service.findPublishedAuthorId('post-1')).toBeNull();
    });
  });

  it('creates a draft post for the authenticated user', async () => {
    const createdPost = {
      _id: { toString: () => 'post-1' },
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      publishedAt: undefined,
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    const posts = {
      create: jest.fn().mockResolvedValue(createdPost),
    };

    const service = new PostsService(posts as never);

    const result = await service.create(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
      },
      '507f1f77bcf86cd799439011',
    );

    expect(posts.create).toHaveBeenCalledWith({
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      authorId: expect.anything(),
      publishedAt: undefined,
    });

    expect(result).toEqual({
      id: 'post-1',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      publishedAt: undefined,
      tags: [],
      images: [],
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
  });

  it('creates a published post with tags and publishedAt', async () => {
    const publishedAt = new Date('2026-11-15T10:00:00.000Z');
    const createdAt = new Date('2026-11-15T10:00:00.000Z');
    const updatedAt = new Date('2026-11-15T10:00:00.000Z');

    const createdPost = {
      _id: { toString: () => 'post-2' },
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      publishedAt,
      tags: ['cairo', 'egypt'],
      images: [],
      createdAt,
      updatedAt,
    };

    const posts = {
      create: jest.fn().mockResolvedValue(createdPost),
    };

    const service = new PostsService(posts as never);

    const result = await service.create(
      {
        title: 'Best places in Cairo',
        body: 'Here are some of my favorite places in Cairo.',
        status: PostStatus.Published,
        tags: ['cairo', 'egypt'],
      },
      '507f1f77bcf86cd799439011',
    );

    expect(posts.create).toHaveBeenCalledWith({
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      tags: ['cairo', 'egypt'],
      authorId: expect.anything(),
      publishedAt: expect.any(Date),
    });

    expect(result).toEqual({
      id: 'post-2',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      publishedAt: '2026-11-15T10:00:00.000Z',
      tags: ['cairo', 'egypt'],
      images: [],
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
  });

  describe('listMine (BLG-03)', () => {
    const userId = '507f1f77bcf86cd799439011';
    const stored = {
      _id: { toString: () => '6740f1c2a4b5c6d7e8f90abc' },
      authorId: { toString: () => userId },
      title: 'Draft trip ideas',
      body: 'Body',
      status: PostStatus.Draft,
      tags: [],
      images: [],
      likeCount: 0,
      commentCount: 0,
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    function setup(found: object[] = [stored], total = 1) {
      const exec = jest.fn().mockResolvedValue(found);
      const limit = jest.fn(() => ({ exec }));
      const skip = jest.fn(() => ({ limit }));
      const sort = jest.fn(() => ({ skip }));
      const countExec = jest.fn().mockResolvedValue(total);
      const posts = {
        find: jest.fn(() => ({ sort })),
        countDocuments: jest.fn(() => ({ exec: countExec })),
      };
      const service = new PostsService(posts as never);
      return { posts, sort, skip, limit, service };
    }

    const queryOf = (page: number, limit: number) =>
      Object.assign(new PaginationQueryDto(), { page, limit });

    it('lists only the posts of the logged-in user, drafts included', async () => {
      const { posts, service } = setup();

      await service.listMine(userId, queryOf(1, 10));

      const [filter] = posts.find.mock.calls[0] as unknown as [
        Record<string, unknown>,
      ];
      expect(Object.keys(filter)).toEqual(['authorId']);
      expect(String(filter.authorId)).toBe(userId);
      expect(posts.countDocuments).toHaveBeenCalledWith(filter);
    });

    it('returns one page, newest first', async () => {
      const { sort, skip, limit, service } = setup();

      await service.listMine(userId, queryOf(3, 10));

      expect(sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(skip).toHaveBeenCalledWith(20);
      expect(limit).toHaveBeenCalledWith(10);
    });

    it('maps each post and adds the page information', async () => {
      const { service } = setup([stored], 21);

      const result = await service.listMine(userId, queryOf(3, 10));

      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 21,
        totalPages: 3,
      });
      expect(result.items).toEqual([
        {
          id: '6740f1c2a4b5c6d7e8f90abc',
          title: 'Draft trip ideas',
          status: PostStatus.Draft,
          createdAt: '2026-11-15T10:00:00.000Z',
          updatedAt: '2026-11-15T10:00:00.000Z',
          likeCount: 0,
          commentCount: 0,
        },
      ]);
    });

    it('answers an empty page when the user has no post', async () => {
      const { service } = setup([], 0);

      expect(await service.listMine(userId, queryOf(1, 10))).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });
});
