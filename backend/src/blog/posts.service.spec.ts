import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

describe('PostsService', () => {
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

  describe('update (BLG-04)', () => {
    const userId = '507f1f77bcf86cd799439011';
    const postId = '6740f1c2a4b5c6d7e8f90abc';

    function createPost(overrides: Record<string, unknown> = {}) {
      return {
        _id: { toString: () => postId },
        authorId: { toString: () => userId },
        title: 'Original title',
        body: 'Original body',
        status: PostStatus.Draft,
        publishedAt: undefined,
        tags: [],
        images: [],
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date('2026-11-15T10:00:00.000Z'),
        updatedAt: new Date('2026-11-15T10:00:00.000Z'),
        save: jest.fn().mockResolvedValue(undefined),
        deleteOne: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('allows the owner to update the title and body', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      const result = await service.update(
        postId,
        {
          title: 'Updated title',
          body: 'Updated body',
        },
        userId,
      );

      expect(posts.findById).toHaveBeenCalledWith(postId);
      expect(post.title).toBe('Updated title');
      expect(post.body).toBe('Updated body');
      expect(post.status).toBe(PostStatus.Draft);
      expect(post.save).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        id: postId,
        authorId: userId,
        title: 'Updated title',
        body: 'Updated body',
        status: PostStatus.Draft,
        publishedAt: undefined,
        tags: [],
        images: [],
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
      });
    });

    it('allows a partial update without changing other fields', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await service.update(
        postId,
        {
          title: 'Only the title changed',
        },
        userId,
      );

      expect(post.title).toBe('Only the title changed');
      expect(post.body).toBe('Original body');
      expect(post.status).toBe(PostStatus.Draft);
      expect(post.save).toHaveBeenCalledTimes(1);
    });

    it('replaces the tags when they are sent, and clears them with [] (BLG-08)', async () => {
      const post = createPost({ tags: ['old', 'tags'] });
      const posts = { findById: jest.fn().mockResolvedValue(post) };
      const service = new PostsService(posts as never);

      const result = await service.update(
        postId,
        { tags: ['cairo', 'nile'] },
        userId,
      );
      expect(post.tags).toEqual(['cairo', 'nile']);
      expect(result.tags).toEqual(['cairo', 'nile']);

      await service.update(postId, { tags: [] }, userId);
      expect(post.tags).toEqual([]);
      expect(post.save).toHaveBeenCalledTimes(2);
    });

    it('keeps the tags when they are not sent (BLG-08)', async () => {
      const post = createPost({ tags: ['keep'] });
      const posts = { findById: jest.fn().mockResolvedValue(post) };
      const service = new PostsService(posts as never);

      await service.update(postId, { title: 'New title' }, userId);

      expect(post.tags).toEqual(['keep']);
    });

    it('publishes a draft and sets publishedAt', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await service.update(
        postId,
        {
          status: PostStatus.Published,
        },
        userId,
      );

      expect(post.status).toBe(PostStatus.Published);
      expect(post.publishedAt).toEqual(expect.any(Date));
      expect(post.save).toHaveBeenCalledTimes(1);
    });

    it('keeps the original publishedAt when an already published post is edited', async () => {
      const originalPublishedAt = new Date('2026-11-14T10:00:00.000Z');

      const post = createPost({
        status: PostStatus.Published,
        publishedAt: originalPublishedAt,
      });

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await service.update(
        postId,
        {
          title: 'Updated published post',
          status: PostStatus.Published,
        },
        userId,
      );

      expect(post.status).toBe(PostStatus.Published);
      expect(post.publishedAt).toBe(originalPublishedAt);
      expect(post.save).toHaveBeenCalledTimes(1);
    });

    it('moves a published post back to draft and clears publishedAt', async () => {
      const post = createPost({
        status: PostStatus.Published,
        publishedAt: new Date('2026-11-14T10:00:00.000Z'),
      });

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await service.update(
        postId,
        {
          status: PostStatus.Draft,
        },
        userId,
      );

      expect(post.status).toBe(PostStatus.Draft);
      expect(post.publishedAt).toBeUndefined();
      expect(post.save).toHaveBeenCalledTimes(1);
    });

    it('rejects updating a post that does not exist', async () => {
      const posts = {
        findById: jest.fn().mockResolvedValue(null),
      };

      const service = new PostsService(posts as never);

      await expect(
        service.update(
          postId,
          {
            title: 'Updated title',
          },
          userId,
        ),
      ).rejects.toThrow('Post not found');
    });

    it('rejects updating another user’s post', async () => {
      const post = createPost({
        authorId: {
          toString: () => '507f191e810c19729de860ea',
        },
      });

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await expect(
        service.update(
          postId,
          {
            title: 'Should not be allowed',
          },
          userId,
        ),
      ).rejects.toThrow('You can only change your own posts');

      expect(post.save).not.toHaveBeenCalled();
    });
  });

  describe('remove (BLG-04)', () => {
    const userId = '507f1f77bcf86cd799439011';
    const postId = '6740f1c2a4b5c6d7e8f90abc';

    function createPost(authorId = userId) {
      return {
        _id: { toString: () => postId },
        authorId: { toString: () => authorId },
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('allows the owner to delete their post', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await service.remove(postId, userId);

      expect(posts.findById).toHaveBeenCalledWith(postId);
      expect(post.deleteOne).toHaveBeenCalledTimes(1);
    });

    it('rejects deleting a post that does not exist', async () => {
      const posts = {
        findById: jest.fn().mockResolvedValue(null),
      };

      const service = new PostsService(posts as never);

      await expect(service.remove(postId, userId)).rejects.toThrow(
        'Post not found',
      );
    });

    it('rejects deleting another user’s post', async () => {
      const post = createPost('507f191e810c19729de860ea');

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = new PostsService(posts as never);

      await expect(service.remove(postId, userId)).rejects.toThrow(
        'You can only change your own posts',
      );

      expect(post.deleteOne).not.toHaveBeenCalled();
    });
  });
});
