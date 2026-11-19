import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommentsService } from './comments.service';
import { CommentModeration } from './models/comment-moderation.enum';
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
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

/** A deleted comment as `findByIdAndDelete(...).lean()` returns it. */
const deletedComment = (moderation?: CommentModeration) => ({
  _id: new Types.ObjectId(COMMENT_ID),
  postId: new Types.ObjectId(POST_ID),
  ...(moderation && { moderation }),
});

/** The guarded -1 and the +1 of the post's `commentCount`. */
const LOWER_COUNT = [
  { _id: new Types.ObjectId(POST_ID), commentCount: { $gt: 0 } },
  { $inc: { commentCount: -1 } },
] as const;
const RAISE_COUNT = [
  { _id: new Types.ObjectId(POST_ID) },
  { $inc: { commentCount: 1 } },
] as const;

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
    findOneAndUpdate: jest.fn(),
    findByIdAndDelete: jest
      .fn()
      .mockReturnValue(query(deletedComment(CommentModeration.Visible))),
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
        moderation: 'visible',
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

      // GEN-10: a hidden comment is left out of the page and of the total.
      const filter = {
        postId: new Types.ObjectId(POST_ID),
        moderation: { $ne: CommentModeration.Hidden },
      };
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

  describe('findVisibleComments (BLG-02)', () => {
    const pageQuery = (page: number, limit: number): PaginationQueryDto =>
      Object.assign(new PaginationQueryDto(), { page, limit });

    it('returns the stored comments of one page, oldest first, and the total of visible ones', async () => {
      const { service, comments } = setup();
      const first = storedComment('First', '2026-11-15T10:00:00.000Z');
      const second = storedComment('Second', '2026-11-15T11:00:00.000Z');
      const findQuery = query([first, second]);
      comments.find.mockReturnValue(findQuery);
      comments.countDocuments.mockReturnValue(query(12));

      const result = await service.findVisibleComments(
        POST_ID,
        pageQuery(2, 5),
      );

      // The same filter, order and page as listForPost; GEN-10: a hidden
      // comment is neither on the page nor in the total.
      const filter = {
        postId: new Types.ObjectId(POST_ID),
        moderation: { $ne: CommentModeration.Hidden },
      };
      expect(comments.find).toHaveBeenCalledWith(filter);
      expect(comments.countDocuments).toHaveBeenCalledWith(filter);
      expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
      expect(findQuery.skip).toHaveBeenCalledWith(5);
      expect(findQuery.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual({ comments: [first, second], total: 12 });
    });

    it('does not check the post: the caller has done that', async () => {
      const { service, posts, comments } = setup({ postIsPublished: false });
      comments.find.mockReturnValue(query([]));
      comments.countDocuments.mockReturnValue(query(0));

      await expect(
        service.findVisibleComments(POST_ID, pageQuery(1, 10)),
      ).resolves.toEqual({ comments: [], total: 0 });
      expect(posts.exists).not.toHaveBeenCalled();
    });

    it('gives listForPost the same comments and total', async () => {
      const { service, comments } = setup();
      const first = storedComment('First', '2026-11-15T10:00:00.000Z');
      comments.find.mockReturnValue(query([first]));
      comments.countDocuments.mockReturnValue(query(1));
      const shared = jest.spyOn(service, 'findVisibleComments');

      const page = await service.listForPost(POST_ID, pageQuery(1, 10));

      expect(shared).toHaveBeenCalledTimes(1);
      expect(shared).toHaveBeenCalledWith(POST_ID, pageQuery(1, 10));
      expect(page.items.map((item) => item.id)).toEqual([first.id]);
      expect(page.meta.total).toBe(1);
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

      expect(comments.findByIdAndDelete).toHaveBeenCalledWith(
        comment._id.toString(),
      );
      expect(posts.updateOne).toHaveBeenCalledWith(...LOWER_COUNT);
    });

    it('deletes my own hidden comment without lowering the count again (GEN-10)', async () => {
      const { service, posts, comments } = setup();
      comments.findById.mockReturnValue(query(ownComment()));
      comments.findByIdAndDelete.mockReturnValue(
        query(deletedComment(CommentModeration.Hidden)),
      );

      await service.remove(COMMENT_ID, USER_ID);

      expect(comments.findByIdAndDelete).toHaveBeenCalledTimes(1);
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('answers 403 and deletes nothing for a comment of another user', async () => {
      const { service, posts, comments } = setup();
      comments.findById.mockReturnValue(query(ownComment()));

      await expect(service.remove(COMMENT_ID, OTHER_USER_ID)).rejects.toThrow(
        new ForbiddenException('You can only delete your own comments'),
      );

      expect(comments.findByIdAndDelete).not.toHaveBeenCalled();
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a comment that does not exist', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(query(null));

      await expect(service.remove(COMMENT_ID, USER_ID)).rejects.toThrow(
        new NotFoundException('Comment not found'),
      );

      expect(comments.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('does not lower the count when another request deleted the comment first', async () => {
      const { service, posts, comments } = setup();
      comments.findById.mockReturnValue(query(ownComment()));
      comments.findByIdAndDelete.mockReturnValue(query(null));

      await service.remove(COMMENT_ID, USER_ID);

      expect(posts.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('findSummary (GEN-09)', () => {
    it('returns the author, the post and the moderation of a comment', async () => {
      const { service, comments } = setup();
      const lookup = query({
        authorId: new Types.ObjectId(USER_ID),
        postId: new Types.ObjectId(POST_ID),
        moderation: CommentModeration.Hidden,
      });
      comments.findById.mockReturnValue(lookup);

      expect(await service.findSummary(COMMENT_ID)).toEqual({
        authorId: USER_ID,
        postId: POST_ID,
        moderation: CommentModeration.Hidden,
      });
      expect(comments.findById).toHaveBeenCalledWith(COMMENT_ID);
      expect(lookup.select).toHaveBeenCalledWith('authorId postId moderation');
    });

    it('reads a comment stored before `moderation` existed as visible', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(
        query({
          authorId: new Types.ObjectId(USER_ID),
          postId: new Types.ObjectId(POST_ID),
        }),
      );

      expect((await service.findSummary(COMMENT_ID))?.moderation).toBe(
        CommentModeration.Visible,
      );
    });

    it('returns null for a comment that does not exist', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(query(null));

      expect(await service.findSummary(COMMENT_ID)).toBeNull();
    });
  });

  describe('admin moderation (GEN-10)', () => {
    it('findForAdmin: any comment, hidden or not, mapped', async () => {
      const { service, comments } = setup();
      const hidden = {
        ...storedComment('Rude', '2026-11-15T10:00:00.000Z'),
        moderation: CommentModeration.Hidden,
      };
      comments.findById.mockReturnValue(query(hidden));

      expect(await service.findForAdmin(COMMENT_ID)).toMatchObject({
        id: hidden.id,
        body: 'Rude',
        moderation: 'hidden',
      });
      expect(comments.findById).toHaveBeenCalledWith(COMMENT_ID);
    });

    it('findForAdmin: null when there is no such comment', async () => {
      const { service, comments } = setup();
      comments.findById.mockReturnValue(query(null));

      expect(await service.findForAdmin(COMMENT_ID)).toBeNull();
    });

    it.each([
      [1, true],
      [0, false],
    ])('existsById: a count of %p is %p', async (count, expected) => {
      const { service, comments } = setup();
      comments.countDocuments.mockReturnValue(query(count));

      expect(await service.existsById(COMMENT_ID)).toBe(expected);
      expect(comments.countDocuments).toHaveBeenCalledWith({ _id: COMMENT_ID });
    });

    it('hides a visible comment in one conditional update and lowers the count once', async () => {
      const { service, posts, comments } = setup();
      comments.findOneAndUpdate.mockReturnValue(
        query({ postId: new Types.ObjectId(POST_ID) }),
      );

      expect(await service.setHidden(COMMENT_ID, true)).toBe(true);
      expect(comments.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: COMMENT_ID, moderation: { $ne: CommentModeration.Hidden } },
        { $set: { moderation: CommentModeration.Hidden } },
        { timestamps: false },
      );
      expect(posts.updateOne).toHaveBeenCalledTimes(1);
      expect(posts.updateOne).toHaveBeenCalledWith(...LOWER_COUNT);
    });

    it('shows a hidden comment again and raises the count once', async () => {
      const { service, posts, comments } = setup();
      comments.findOneAndUpdate.mockReturnValue(
        query({ postId: new Types.ObjectId(POST_ID) }),
      );

      expect(await service.setHidden(COMMENT_ID, false)).toBe(true);
      expect(comments.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: COMMENT_ID, moderation: CommentModeration.Hidden },
        { $set: { moderation: CommentModeration.Visible } },
        { timestamps: false },
      );
      expect(posts.updateOne).toHaveBeenCalledTimes(1);
      expect(posts.updateOne).toHaveBeenCalledWith(...RAISE_COUNT);
    });

    it.each([true, false])(
      'setHidden(%p) returns false and leaves the count when nothing changed (missing, or already in that state)',
      async (hidden) => {
        const { service, posts, comments } = setup();
        comments.findOneAndUpdate.mockReturnValue(query(null));

        expect(await service.setHidden(COMMENT_ID, hidden)).toBe(false);
        expect(posts.updateOne).not.toHaveBeenCalled();
      },
    );

    it('removeByAdmin deletes exactly one comment by id and lowers the count when it was visible', async () => {
      const { service, posts, comments } = setup();

      expect(await service.removeByAdmin(COMMENT_ID)).toBe(true);
      expect(comments.findByIdAndDelete).toHaveBeenCalledTimes(1);
      expect(comments.findByIdAndDelete).toHaveBeenCalledWith(COMMENT_ID);
      expect(posts.updateOne).toHaveBeenCalledWith(...LOWER_COUNT);
    });

    it('removeByAdmin of a hidden comment leaves the count (it was taken off when hidden)', async () => {
      const { service, posts, comments } = setup();
      comments.findByIdAndDelete.mockReturnValue(
        query(deletedComment(CommentModeration.Hidden)),
      );

      expect(await service.removeByAdmin(COMMENT_ID)).toBe(true);
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('removeByAdmin of a comment stored before `moderation` existed lowers the count', async () => {
      const { service, posts, comments } = setup();
      comments.findByIdAndDelete.mockReturnValue(query(deletedComment()));

      expect(await service.removeByAdmin(COMMENT_ID)).toBe(true);
      expect(posts.updateOne).toHaveBeenCalledWith(...LOWER_COUNT);
    });

    it('removeByAdmin returns false and leaves the count when there is no such comment', async () => {
      const { service, posts, comments } = setup();
      comments.findByIdAndDelete.mockReturnValue(query(null));

      expect(await service.removeByAdmin(COMMENT_ID)).toBe(false);
      expect(posts.updateOne).not.toHaveBeenCalled();
    });
  });
});
