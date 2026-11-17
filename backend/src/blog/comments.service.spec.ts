import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommentsService } from './comments.service';
import { visiblePublishedPost } from './visible-post.filter';

const POST_ID = '6740a1b2c3d4e5f601234560';
const USER_ID = '6740a1b2c3d4e5f601234561';
const OTHER_USER_ID = '6740a1b2c3d4e5f601234562';
const COMMENT_ID = '6740a1b2c3d4e5f601234563';

/** A stored comment, as much of it as the mapper reads. */
const storedComment = (body: string, createdAt: string) => {
  const id = new Types.ObjectId();
  return {
    id: id.toString(),
    _id: id,
    postId: new Types.ObjectId(POST_ID),
    authorId: new Types.ObjectId(USER_ID),
    body,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
};

/** A Mongoose query that resolves to `value` when `.exec()` is called. */
const query = <T>(value: T) => {
  const chain = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
};

const setup = (options: { postIsPublished?: boolean } = {}) => {
  const postFound = options.postIsPublished ?? true;

  const posts = {
    exists: jest
      .fn()
      .mockReturnValue(
        query(postFound ? { _id: new Types.ObjectId(POST_ID) } : null),
      ),
    updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
  };
  const comments = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest.fn().mockReturnValue(query({ deletedCount: 1 })),
  };
  const service = new CommentsService(comments as never, posts as never);

  return { service, posts, comments };
};

describe('CommentsService', () => {
  describe('create (BLG-05)', () => {
    it('saves the comment for the logged-in user and returns it', async () => {
      const { service, comments } = setup();
      const saved = storedComment('Great tips!', '2026-11-15T10:00:00.000Z');
      comments.create.mockResolvedValue(saved);

      const result = await service.create(
        POST_ID,
        { body: 'Great tips!' },
        USER_ID,
      );

      expect(comments.create).toHaveBeenCalledWith({
        postId: new Types.ObjectId(POST_ID),
        authorId: new Types.ObjectId(USER_ID),
        body: 'Great tips!',
      });
      expect(result).toEqual({
        id: saved.id,
        postId: POST_ID,
        authorId: USER_ID,
        body: 'Great tips!',
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
      });
    });

    it('only accepts a published post', async () => {
      const { service, posts, comments } = setup();
      comments.create.mockResolvedValue(
        storedComment('Great tips!', '2026-11-15T10:00:00.000Z'),
      );

      await service.create(POST_ID, { body: 'Great tips!' }, USER_ID);

      // Published and not hidden by an admin, unless it is the user's own
      // (GEN-10).
      expect(posts.exists).toHaveBeenCalledWith(
        visiblePublishedPost(POST_ID, USER_ID),
      );
    });

    it('checks the post for a guest when listing: a hidden post is refused for everyone (GEN-10)', async () => {
      const { service, posts } = setup();
      posts.exists.mockReturnValue({ exec: () => Promise.resolve(null) });

      await expect(
        service.listForPost(POST_ID, { page: 1, limit: 10, skip: 0 } as never),
      ).rejects.toThrow('Post not found');
      expect(posts.exists).toHaveBeenCalledWith(visiblePublishedPost(POST_ID));
    });

    it('adds one to the comment count of the post in one atomic update', async () => {
      const { service, posts, comments } = setup();
      comments.create.mockResolvedValue(
        storedComment('Great tips!', '2026-11-15T10:00:00.000Z'),
      );

      await service.create(POST_ID, { body: 'Great tips!' }, USER_ID);

      expect(posts.updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(POST_ID) },
        { $inc: { commentCount: 1 } },
      );
    });

    it('answers 404 and saves nothing when the post is missing or a draft', async () => {
      const { service, posts, comments } = setup({ postIsPublished: false });

      await expect(
        service.create(POST_ID, { body: 'Great tips!' }, USER_ID),
      ).rejects.toThrow(new NotFoundException('Post not found'));

      expect(comments.create).not.toHaveBeenCalled();
      expect(posts.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('listForPost (BLG-05)', () => {
    const pageQuery = (page: number, limit: number): PaginationQueryDto =>
      Object.assign(new PaginationQueryDto(), { page, limit });

    it('returns one page of comments, oldest first, with the total', async () => {
      const { service, comments } = setup();
      const first = storedComment('First', '2026-11-15T10:00:00.000Z');
      const second = storedComment('Second', '2026-11-15T11:00:00.000Z');
      const findQuery = query([first, second]);
      comments.find.mockReturnValue(findQuery);
      comments.countDocuments.mockReturnValue(query(12));

      const result = await service.listForPost(POST_ID, pageQuery(2, 5));

      const filter = { postId: new Types.ObjectId(POST_ID) };
      expect(comments.find).toHaveBeenCalledWith(filter);
      expect(comments.countDocuments).toHaveBeenCalledWith(filter);
      expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
      expect(findQuery.skip).toHaveBeenCalledWith(5);
      expect(findQuery.limit).toHaveBeenCalledWith(5);

      expect(result.items.map((item) => item.body)).toEqual([
        'First',
        'Second',
      ]);
      expect(result.meta).toEqual({
        page: 2,
        limit: 5,
        total: 12,
        totalPages: 3,
      });
    });

    it('returns an empty page for a post without comments', async () => {
      const { service, comments } = setup();
      comments.find.mockReturnValue(query([]));
      comments.countDocuments.mockReturnValue(query(0));

      const result = await service.listForPost(POST_ID, pageQuery(1, 10));

      expect(result).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('answers 404 when the post is missing or a draft', async () => {
      const { service, comments } = setup({ postIsPublished: false });

      await expect(
        service.listForPost(POST_ID, pageQuery(1, 10)),
      ).rejects.toThrow(new NotFoundException('Post not found'));

      expect(comments.find).not.toHaveBeenCalled();
    });
  });

  /** A comment by USER_ID as `findById` returns it, with a working `save`. */
  const ownComment = () => ({
    ...storedComment('Great tips!', '2026-11-15T10:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
  });

  describe('update (BLG-07)', () => {
    it('changes the text of my own comment and returns it', async () => {
      const { service, comments } = setup();
      const comment = ownComment();
      comments.findById.mockReturnValue(query(comment));

      const result = await service.update(
        COMMENT_ID,
        { body: 'Even better tips!' },
        USER_ID,
      );

      expect(comments.findById).toHaveBeenCalledWith(COMMENT_ID);
      expect(comment.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        id: comment.id,
        authorId: USER_ID,
        body: 'Even better tips!',
      });
    });

    it('answers 403 and changes nothing for a comment of another user', async () => {
      const { service, comments } = setup();
      const comment = ownComment();
      comments.findById.mockReturnValue(query(comment));

      await expect(
        service.update(COMMENT_ID, { body: 'Hijacked' }, OTHER_USER_ID),
      ).rejects.toThrow(
        new ForbiddenException('You can only edit your own comments'),
      );

      expect(comment.save).not.toHaveBeenCalled();
      expect(comment.body).toBe('Great tips!');
    });

    it('answers 404 for a comment that does not exist', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(query(null));

      await expect(
        service.update(COMMENT_ID, { body: 'Hello' }, USER_ID),
      ).rejects.toThrow(new NotFoundException('Comment not found'));
    });
  });

  describe('remove (BLG-07)', () => {
    it('deletes my own comment by its id and lowers the comment count of the post', async () => {
      const { service, posts, comments } = setup();
      const comment = ownComment();
      comments.findById.mockReturnValue(query(comment));

      await service.remove(COMMENT_ID, USER_ID);

      expect(comments.deleteOne).toHaveBeenCalledWith({ _id: comment._id });
      expect(posts.updateOne).toHaveBeenCalledWith(
        { _id: comment.postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
      );
    });

    it('answers 403 and deletes nothing for a comment of another user', async () => {
      const { service, posts, comments } = setup();
      comments.findById.mockReturnValue(query(ownComment()));

      await expect(service.remove(COMMENT_ID, OTHER_USER_ID)).rejects.toThrow(
        new ForbiddenException('You can only delete your own comments'),
      );

      expect(comments.deleteOne).not.toHaveBeenCalled();
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a comment that does not exist', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(query(null));

      await expect(service.remove(COMMENT_ID, USER_ID)).rejects.toThrow(
        new NotFoundException('Comment not found'),
      );

      expect(comments.deleteOne).not.toHaveBeenCalled();
    });

    it('does not lower the count when another request deleted the comment first', async () => {
      const { service, posts, comments } = setup();
      comments.findById.mockReturnValue(query(ownComment()));
      comments.deleteOne.mockReturnValue(query({ deletedCount: 0 }));

      await service.remove(COMMENT_ID, USER_ID);

      expect(posts.updateOne).not.toHaveBeenCalled();
    });
  });
});
