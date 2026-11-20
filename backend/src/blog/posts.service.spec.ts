import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ItineraryModeration } from '../itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../itineraries/enums/itinerary-visibility.enum';
import {
  ONLY_PUBLIC_ITINERARY_MESSAGE,
  OWN_ITINERARY_ONLY_MESSAGE,
} from './blog.constants';
import { PostModeration } from './models/post-moderation.enum';
import { PostStatus } from './models/post-status.enum';
import { PostsService } from './posts.service';
import { visiblePublishedPost } from './visible-post.filter';

/** A comments or likes model whose deleteMany removes `count` records. */
const engagement = (count = 0) => ({
  deleteMany: jest.fn(() => ({
    exec: () => Promise.resolve({ deletedCount: count }),
  })),
});

/** An UploadsService whose deleteImage resolves (BLG-10). */
const uploadsStub = () => ({
  deleteImage: jest.fn().mockResolvedValue(undefined),
});

const createService = (posts: unknown, uploads: unknown = uploadsStub()) =>
  new PostsService(
    posts as never,
    engagement() as never,
    engagement() as never,
    uploads as never,
    {} as never,
  );

describe('PostsService', () => {
  describe('findPublishedSummary (GEN-09, GEN-10)', () => {
    const lookup = (found: unknown) => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(found),
      };
      const posts = { findOne: jest.fn().mockReturnValue(query) };
      return {
        service: new PostsService(
          posts as never,
          engagement() as never,
          engagement() as never,
          uploadsStub() as never,
          {} as never,
        ),
        posts,
        query,
      };
    };

    it('returns the author id and the moderation of a published post', async () => {
      const { service, posts, query } = lookup({
        authorId: { toString: () => '507f1f77bcf86cd799439011' },
        moderation: PostModeration.Hidden,
      });

      expect(await service.findPublishedSummary('post-1')).toEqual({
        authorId: '507f1f77bcf86cd799439011',
        moderation: PostModeration.Hidden,
        authorDeactivated: false,
      });
      expect(posts.findOne).toHaveBeenCalledWith({
        _id: 'post-1',
        status: PostStatus.Published,
      });
      expect(query.select).toHaveBeenCalledWith(
        'authorId moderation authorDeactivated',
      );
    });

    it('reads a post stored before moderation and authorDeactivated existed as visible, author active', async () => {
      const { service } = lookup({
        authorId: { toString: () => '507f1f77bcf86cd799439011' },
      });

      expect(await service.findPublishedSummary('post-1')).toEqual({
        authorId: '507f1f77bcf86cd799439011',
        moderation: PostModeration.Visible,
        authorDeactivated: false,
      });
    });

    it.each([
      [true, true],
      [false, false],
    ])(
      'returns authorDeactivated %p when the post has %p (ACC-12)',
      async (stored, expected) => {
        const { service } = lookup({
          authorId: { toString: () => '507f1f77bcf86cd799439011' },
          moderation: PostModeration.Visible,
          authorDeactivated: stored,
        });

        expect(await service.findPublishedSummary('post-1')).toMatchObject({
          authorDeactivated: expected,
        });
      },
    );

    it('returns null for a missing post or a draft', async () => {
      const { service } = lookup(null);

      expect(await service.findPublishedSummary('post-1')).toBeNull();
    });
  });

  describe('markAuthorDeactivated (ACC-12)', () => {
    const AUTHOR_ID = '507f1f77bcf86cd799439011';

    const setupUpdate = () => {
      const exec = jest.fn().mockResolvedValue({ modifiedCount: 2 });
      const posts = { updateMany: jest.fn(() => ({ exec })) };
      return { service: createService(posts), posts, exec };
    };

    it('flags every post of the author, in one update that keeps updatedAt', async () => {
      const { service, posts, exec } = setupUpdate();

      await expect(
        service.markAuthorDeactivated(AUTHOR_ID),
      ).resolves.toBeUndefined();

      expect(posts.updateMany).toHaveBeenCalledTimes(1);
      expect(posts.updateMany).toHaveBeenCalledWith(
        { authorId: new Types.ObjectId(AUTHOR_ID) },
        { $set: { authorDeactivated: true } },
        { timestamps: false },
      );
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('names exactly one field in its filter: the author', async () => {
      const { service, posts } = setupUpdate();

      await service.markAuthorDeactivated(AUTHOR_ID);

      const [filter] = posts.updateMany.mock.calls[0] as unknown as [
        Record<string, unknown>,
      ];
      expect(Object.keys(filter)).toEqual(['authorId']);
    });
  });

  describe('admin moderation (GEN-10)', () => {
    /** A model whose queries all answer `found`. */
    const model = (found: unknown) => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(found),
      };
      const posts = {
        countDocuments: jest.fn().mockReturnValue(query),
        findOneAndUpdate: jest.fn().mockReturnValue(query),
        findByIdAndDelete: jest.fn().mockReturnValue(query),
      };
      const comments = engagement(2);
      const likes = engagement(3);
      return {
        service: new PostsService(
          posts as never,
          comments as never,
          likes as never,
          uploadsStub() as never,
          {} as never,
        ),
        posts,
        query,
        comments,
        likes,
      };
    };

    it.each([
      [1, true],
      [0, false],
    ])('existsById: a count of %p is %p', async (count, expected) => {
      const { service, posts } = model(count);

      expect(await service.existsById('post-1')).toBe(expected);
      expect(posts.countDocuments).toHaveBeenCalledWith({ _id: 'post-1' });
    });

    it.each([
      [1, true],
      [0, false],
    ])(
      'isVisibleTo (GEN-09): a count of %p is %p, by the visiblePublishedPost rule',
      async (count, expected) => {
        const { service, posts } = model(count);
        const postId = '507f1f77bcf86cd799439012';
        const viewerId = '507f1f77bcf86cd799439011';

        expect(await service.isVisibleTo(postId, viewerId)).toBe(expected);
        expect(posts.countDocuments).toHaveBeenCalledWith(
          visiblePublishedPost(postId, viewerId),
        );
      },
    );

    it.each([
      [PostModeration.Hidden, true],
      [PostModeration.Visible, false],
    ])(
      'findForAdmin: any post, moderation %p is hidden=%p',
      async (moderation, hidden) => {
        const postId = new Types.ObjectId();
        const authorId = new Types.ObjectId();
        const { service } = model(null);
        const posts = {
          findById: jest.fn().mockReturnValue({
            exec: () =>
              Promise.resolve({
                _id: postId,
                authorId,
                title: 'Draft',
                body: 'Body',
                status: PostStatus.Draft,
                moderation,
                tags: [],
                images: [],
                createdAt: new Date('2026-11-17T10:00:00.000Z'),
                updatedAt: new Date('2026-11-17T10:00:00.000Z'),
              }),
          }),
        };
        Object.assign(service, { posts });

        const found = await service.findForAdmin(postId.toString());

        expect(posts.findById).toHaveBeenCalledWith(postId.toString());
        expect(found).toEqual({
          hidden,
          post: expect.objectContaining({
            id: postId.toString(),
            authorId: authorId.toString(),
            status: PostStatus.Draft,
            createdAt: '2026-11-17T10:00:00.000Z',
          }),
        });
      },
    );

    it('findForAdmin: null when there is no such post', async () => {
      const { service } = model(null);
      Object.assign(service, {
        posts: { findById: () => ({ exec: () => Promise.resolve(null) }) },
      });

      expect(await service.findForAdmin('507f1f77bcf86cd799439012')).toBeNull();
    });

    it('hides a post that is not hidden yet, in one conditional update', async () => {
      const { service, posts } = model({ _id: 'post-1' });

      expect(await service.setHidden('post-1', true)).toBe(true);
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'post-1', moderation: { $ne: PostModeration.Hidden } },
        { $set: { moderation: PostModeration.Hidden } },
        { timestamps: false },
      );
    });

    it('shows a hidden post again, only if it is hidden', async () => {
      const { service, posts } = model({ _id: 'post-1' });

      expect(await service.setHidden('post-1', false)).toBe(true);
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'post-1', moderation: PostModeration.Hidden },
        { $set: { moderation: PostModeration.Visible } },
        { timestamps: false },
      );
    });

    it('returns false when nothing matched (missing or already in that state)', async () => {
      const { service } = model(null);

      expect(await service.setHidden('post-1', true)).toBe(false);
    });

    it('deletes any post and returns its image file names', async () => {
      const { service, posts, query } = model({ images: ['a.jpg', 'b.png'] });

      const postId = '6740f1c2a4b5c6d7e8f90abc';
      expect(await service.removeByAdmin(postId)).toEqual(['a.jpg', 'b.png']);
      expect(posts.findByIdAndDelete).toHaveBeenCalledWith(postId);
      expect(query.select).toHaveBeenCalledWith('images');
    });

    it('returns an empty list for a post without images', async () => {
      const { service } = model({});

      expect(await service.removeByAdmin('6740f1c2a4b5c6d7e8f90abc')).toEqual(
        [],
      );
    });

    it('returns null when there was no such post, and deletes no comments or likes', async () => {
      const { service, comments, likes } = model(null);

      expect(await service.removeByAdmin('post-1')).toBeNull();
      expect(comments.deleteMany).not.toHaveBeenCalled();
      expect(likes.deleteMany).not.toHaveBeenCalled();
    });

    it('also deletes the comments and likes of the deleted post, and only those', async () => {
      const { service, comments, likes } = model({ images: [] });
      const postId = '6740f1c2a4b5c6d7e8f90abc';

      await service.removeByAdmin(postId);

      const filter = { postId: new Types.ObjectId(postId) };
      expect(comments.deleteMany).toHaveBeenCalledWith(filter);
      expect(likes.deleteMany).toHaveBeenCalledWith(filter);
    });

    it('still returns the images when deleting the comments and likes fails, and logs it', async () => {
      const { service, comments } = model({ images: ['a.jpg'] });
      comments.deleteMany.mockImplementation(() => ({
        exec: () => Promise.reject(new Error('database down')),
      }));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      // The post is already deleted, so this is not a 500: a retry would
      // answer 404 and the images would never be removed.
      await expect(
        service.removeByAdmin('6740f1c2a4b5c6d7e8f90abc'),
      ).resolves.toEqual(['a.jpg']);
      expect(logError).toHaveBeenCalledTimes(1);
      logError.mockRestore();
    });

    it('removeEngagementOfPost returns how many comments and likes it deleted', async () => {
      const { service } = model(null);

      expect(
        await service.removeEngagementOfPost('6740f1c2a4b5c6d7e8f90abc'),
      ).toEqual({ comments: 2, likes: 3 });
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

    const service = new PostsService(
      posts as never,
      engagement() as never,
      engagement() as never,
      uploadsStub() as never,
      {} as never,
    );

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
      itineraryId: null,
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

    const service = new PostsService(
      posts as never,
      engagement() as never,
      engagement() as never,
      uploadsStub() as never,
      {} as never,
    );

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
      itineraryId: null,
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
      moderation: PostModeration.Visible,
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
      const service = new PostsService(
        posts as never,
        engagement() as never,
        engagement() as never,
        uploadsStub() as never,
        {} as never,
      );
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
          moderation: PostModeration.Visible,
          itineraryId: null,
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

      const service = createService(posts);

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
        itineraryId: null,
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
      });
    });

    it('allows a partial update without changing other fields', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = createService(posts);

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
      const service = createService(posts);

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
      const service = createService(posts);

      await service.update(postId, { title: 'New title' }, userId);

      expect(post.tags).toEqual(['keep']);
    });

    it('publishes a draft and sets publishedAt', async () => {
      const post = createPost();

      const posts = {
        findById: jest.fn().mockResolvedValue(post),
      };

      const service = createService(posts);

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

      const service = createService(posts);

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

      const service = createService(posts);

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

      const service = createService(posts);

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

      const service = createService(posts);

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

  describe('remove (BLG-04, BLG-10)', () => {
    const userId = '507f1f77bcf86cd799439011';
    const postId = '6740f1c2a4b5c6d7e8f90abc';

    function createPost(authorId = userId) {
      return {
        _id: { toString: () => postId },
        authorId: { toString: () => authorId },
      };
    }

    /** A posts model: the owner check finds `post`, the delete returns `deleted`. */
    function postsModel(post: unknown, deleted: unknown = { images: [] }) {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(deleted),
      };
      return {
        findById: jest.fn().mockResolvedValue(post),
        findByIdAndDelete: jest.fn().mockReturnValue(query),
        query,
      };
    }

    it('allows the owner to delete their post and removes its engagement', async () => {
      const posts = postsModel(createPost());
      const comments = engagement();
      const likes = engagement();

      const service = new PostsService(
        posts as never,
        comments as never,
        likes as never,
        uploadsStub() as never,
        {} as never,
      );

      await service.remove(postId, userId);

      expect(posts.findById).toHaveBeenCalledWith(postId);
      expect(posts.findByIdAndDelete).toHaveBeenCalledTimes(1);
      expect(posts.findByIdAndDelete).toHaveBeenCalledWith(postId);
      expect(posts.query.select).toHaveBeenCalledWith('images');
      expect(comments.deleteMany).toHaveBeenCalledWith({
        postId: new Types.ObjectId(postId),
      });
      expect(likes.deleteMany).toHaveBeenCalledWith({
        postId: new Types.ObjectId(postId),
      });
    });

    it('deletes the image files of the deleted post, by the names it stored (BLG-10)', async () => {
      const posts = postsModel(createPost(), { images: ['a.jpg', 'b.png'] });
      const uploads = uploadsStub();
      const service = createService(posts, uploads);

      await service.remove(postId, userId);

      expect(uploads.deleteImage).toHaveBeenCalledTimes(2);
      expect(uploads.deleteImage).toHaveBeenCalledWith('a.jpg');
      expect(uploads.deleteImage).toHaveBeenCalledWith('b.png');
      // The files go only after the post itself is deleted.
      expect(posts.findByIdAndDelete.mock.invocationCallOrder[0]).toBeLessThan(
        uploads.deleteImage.mock.invocationCallOrder[0],
      );
    });

    it('still resolves, tries every file and logs each one that cannot be deleted', async () => {
      const posts = postsModel(createPost(), { images: ['a.jpg', 'b.png'] });
      const uploads = uploadsStub();
      uploads.deleteImage
        .mockRejectedValueOnce(new Error('disk error'))
        .mockResolvedValueOnce(undefined);
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const service = createService(posts, uploads);

      await expect(service.remove(postId, userId)).resolves.toBeUndefined();

      expect(uploads.deleteImage).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('a.jpg');

      logError.mockRestore();
    });

    it('deletes no file when the post has no images', async () => {
      const posts = postsModel(createPost(), { images: [] });
      const uploads = uploadsStub();
      const service = createService(posts, uploads);

      await service.remove(postId, userId);

      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('does no cleanup when another request deleted the post in the meantime', async () => {
      const posts = postsModel(createPost(), null);
      const comments = engagement();
      const likes = engagement();
      const uploads = uploadsStub();
      const service = new PostsService(
        posts as never,
        comments as never,
        likes as never,
        uploads as never,
        {} as never,
      );

      await expect(service.remove(postId, userId)).resolves.toBeUndefined();

      expect(comments.deleteMany).not.toHaveBeenCalled();
      expect(likes.deleteMany).not.toHaveBeenCalled();
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('logs engagement cleanup failure without throwing after the post is deleted, and still deletes the files', async () => {
      const posts = postsModel(createPost(), { images: ['a.jpg'] });
      const comments = engagement();

      comments.deleteMany.mockImplementation(() => ({
        exec: () => Promise.reject(new Error('database down')),
      }));

      const likes = engagement();
      const uploads = uploadsStub();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const service = new PostsService(
        posts as never,
        comments as never,
        likes as never,
        uploads as never,
        {} as never,
      );

      await expect(service.remove(postId, userId)).resolves.toBeUndefined();

      expect(posts.findByIdAndDelete).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(uploads.deleteImage).toHaveBeenCalledWith('a.jpg');

      logError.mockRestore();
    });

    it('rejects deleting a post that does not exist', async () => {
      const posts = postsModel(null);
      const uploads = uploadsStub();

      const service = createService(posts, uploads);

      await expect(service.remove(postId, userId)).rejects.toThrow(
        'Post not found',
      );
      expect(posts.findByIdAndDelete).not.toHaveBeenCalled();
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('rejects deleting another user’s post', async () => {
      const posts = postsModel(createPost('507f191e810c19729de860ea'), {
        images: ['a.jpg'],
      });
      const uploads = uploadsStub();

      const service = createService(posts, uploads);

      await expect(service.remove(postId, userId)).rejects.toThrow(
        'You can only change your own posts',
      );

      expect(posts.findByIdAndDelete).not.toHaveBeenCalled();
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('attachItinerary (BLG-13)', () => {
    const AUTHOR = '507f1f77bcf86cd799439011';
    const POST_ID = '6740f1c2a4b5c6d7e8f90abc';
    const ITINERARY_ID = '6741c0ffee0ddba11ad0b0b0';
    const OTHER_ITINERARY_ID = '6741c0ffee0ddba11ad0b0b1';

    /** A post of AUTHOR, with `attached` as its itinerary (or none). */
    const storedPost = (attached?: string) => ({
      _id: new Types.ObjectId(POST_ID),
      authorId: new Types.ObjectId(AUTHOR),
      title: 'Three days in Cairo',
      body: 'Body',
      status: PostStatus.Draft,
      tags: [],
      images: [],
      ...(attached && { itineraryId: new Types.ObjectId(attached) }),
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    });

    const setup = (
      options: {
        post?: ReturnType<typeof storedPost> | null;
        itinerary?: { visibility: string; moderation: string };
        itineraryError?: Error;
        updated?: unknown;
      } = {},
    ) => {
      const post = options.post === undefined ? storedPost() : options.post;
      const findOneAndUpdate = jest.fn(
        (
          _filter: unknown,
          update: Record<string, Record<string, unknown>>,
        ) => ({
          exec: () =>
            Promise.resolve(
              options.updated !== undefined
                ? options.updated
                : {
                    ...post,
                    itineraryId: update.$set?.itineraryId,
                    updatedAt: new Date('2026-11-16T10:00:00.000Z'),
                  },
            ),
        }),
      );
      const posts = {
        findById: jest.fn().mockResolvedValue(post),
        findOneAndUpdate,
      };
      const itineraries = {
        findOwnedOrThrow: options.itineraryError
          ? jest.fn().mockRejectedValue(options.itineraryError)
          : jest.fn().mockResolvedValue(
              options.itinerary ?? {
                visibility: ItineraryVisibility.Public,
                moderation: ItineraryModeration.Visible,
              },
            ),
      };
      const service = new PostsService(
        posts as never,
        engagement() as never,
        engagement() as never,
        uploadsStub() as never,
        itineraries as never,
      );
      return { service, posts, itineraries, findOneAndUpdate };
    };

    it("attaches the author's own public itinerary in one update by id and author", async () => {
      const { service, itineraries, findOneAndUpdate } = setup();

      const response = await service.attachItinerary(
        POST_ID,
        { itineraryId: ITINERARY_ID },
        AUTHOR,
      );

      expect(itineraries.findOwnedOrThrow).toHaveBeenCalledWith(
        ITINERARY_ID,
        AUTHOR,
        OWN_ITINERARY_ONLY_MESSAGE,
      );
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(POST_ID),
          authorId: new Types.ObjectId(AUTHOR),
        },
        { $set: { itineraryId: new Types.ObjectId(ITINERARY_ID) } },
        { returnDocument: 'after' },
      );
      expect(response.itineraryId).toBe(ITINERARY_ID);
    });

    it('replaces an itinerary attached before', async () => {
      const { service, findOneAndUpdate } = setup({
        post: storedPost(OTHER_ITINERARY_ID),
      });

      const response = await service.attachItinerary(
        POST_ID,
        { itineraryId: ITINERARY_ID },
        AUTHOR,
      );

      expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(response.itineraryId).toBe(ITINERARY_ID);
    });

    it('removes the itinerary with null, without reading it: it may be gone or private', async () => {
      const { service, itineraries, findOneAndUpdate } = setup({
        post: storedPost(ITINERARY_ID),
      });

      const response = await service.attachItinerary(
        POST_ID,
        { itineraryId: null },
        AUTHOR,
      );

      expect(itineraries.findOwnedOrThrow).not.toHaveBeenCalled();
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $unset: { itineraryId: 1 } },
        { returnDocument: 'after' },
      );
      expect(response.itineraryId).toBeNull();
    });

    it('changes nothing when the same itinerary is attached again', async () => {
      const { service, findOneAndUpdate } = setup({
        post: storedPost(ITINERARY_ID),
      });

      const response = await service.attachItinerary(
        POST_ID,
        { itineraryId: ITINERARY_ID },
        AUTHOR,
      );

      expect(findOneAndUpdate).not.toHaveBeenCalled();
      expect(response.itineraryId).toBe(ITINERARY_ID);
      expect(response.updatedAt).toBe('2026-11-15T10:00:00.000Z');
    });

    it('changes nothing when removing from a post that has none', async () => {
      const { service, findOneAndUpdate } = setup();

      const response = await service.attachItinerary(
        POST_ID,
        { itineraryId: null },
        AUTHOR,
      );

      expect(findOneAndUpdate).not.toHaveBeenCalled();
      expect(response.itineraryId).toBeNull();
    });

    it('answers 404 for a missing post and reads no itinerary', async () => {
      const { service, itineraries } = setup({ post: null });

      await expect(
        service.attachItinerary(POST_ID, { itineraryId: ITINERARY_ID }, AUTHOR),
      ).rejects.toThrow(new NotFoundException('Post not found'));
      expect(itineraries.findOwnedOrThrow).not.toHaveBeenCalled();
    });

    it("answers 403 for another user's post and reads no itinerary", async () => {
      const { service, itineraries } = setup();

      await expect(
        service.attachItinerary(
          POST_ID,
          { itineraryId: ITINERARY_ID },
          new Types.ObjectId().toString(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(itineraries.findOwnedOrThrow).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', new NotFoundException('Itinerary not found')],
      ["another user's", new ForbiddenException(OWN_ITINERARY_ONLY_MESSAGE)],
    ])(
      'passes on the answer for a %s itinerary and writes nothing',
      async (_name, error) => {
        const { service, findOneAndUpdate } = setup({ itineraryError: error });

        await expect(
          service.attachItinerary(
            POST_ID,
            { itineraryId: ITINERARY_ID },
            AUTHOR,
          ),
        ).rejects.toBe(error);
        expect(findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'a private itinerary',
        ItineraryVisibility.Private,
        ItineraryModeration.Visible,
      ],
      [
        'a public itinerary an admin hid',
        ItineraryVisibility.Public,
        ItineraryModeration.Hidden,
      ],
      [
        'a private itinerary an admin hid',
        ItineraryVisibility.Private,
        ItineraryModeration.Hidden,
      ],
    ])(
      'answers 409 for %s and writes nothing',
      async (_name, visibility, moderation) => {
        const { service, findOneAndUpdate } = setup({
          itinerary: { visibility, moderation },
        });

        const error: unknown = await service
          .attachItinerary(POST_ID, { itineraryId: ITINERARY_ID }, AUTHOR)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as Error).message).toBe(ONLY_PUBLIC_ITINERARY_MESSAGE);
        expect(findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('answers 409, and keeps the link, when the attached itinerary is sent again after it became private', async () => {
      const { service, findOneAndUpdate } = setup({
        post: storedPost(ITINERARY_ID),
        itinerary: {
          visibility: ItineraryVisibility.Private,
          moderation: ItineraryModeration.Visible,
        },
      });

      await expect(
        service.attachItinerary(POST_ID, { itineraryId: ITINERARY_ID }, AUTHOR),
      ).rejects.toThrow(new ConflictException(ONLY_PUBLIC_ITINERARY_MESSAGE));
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('answers 404 when the post was deleted between the check and the update', async () => {
      const { service } = setup({ updated: null });

      await expect(
        service.attachItinerary(POST_ID, { itineraryId: ITINERARY_ID }, AUTHOR),
      ).rejects.toThrow(new NotFoundException('Post not found'));
    });
  });
});
