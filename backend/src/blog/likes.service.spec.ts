import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LikesService } from './likes.service';
import { PostStatus } from './models/post-status.enum';

const POST_ID = '6740a1b2c3d4e5f601234560';
const USER_ID = '6740a1b2c3d4e5f601234561';

/** A Mongoose query that resolves to `value` when `.exec()` is called. */
const query = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

const setup = (options: { postIsPublished?: boolean } = {}) => {
  const postFound = options.postIsPublished ?? true;

  const posts = {
    exists: jest
      .fn()
      .mockReturnValue(
        query(postFound ? { _id: new Types.ObjectId(POST_ID) } : null),
      ),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
  };
  const likes = {
    create: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn(),
  };
  const service = new LikesService(likes as never, posts as never);

  return { service, posts, likes };
};

describe('LikesService', () => {
  describe('like (BLG-06)', () => {
    it('stores the like of the logged-in user and returns the new count', async () => {
      const { service, posts, likes } = setup();
      posts.findOneAndUpdate.mockReturnValue(query({ likeCount: 3 }));

      const result = await service.like(POST_ID, USER_ID);

      expect(likes.create).toHaveBeenCalledWith({
        postId: new Types.ObjectId(POST_ID),
        userId: new Types.ObjectId(USER_ID),
      });
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: POST_ID },
        { $inc: { likeCount: 1 } },
        { returnDocument: 'after' },
      );
      expect(result).toEqual({ postId: POST_ID, liked: true, likeCount: 3 });
    });

    it('only accepts a published post', async () => {
      const { service, posts } = setup();
      posts.findOneAndUpdate.mockReturnValue(query({ likeCount: 1 }));

      await service.like(POST_ID, USER_ID);

      expect(posts.exists).toHaveBeenCalledWith({
        _id: POST_ID,
        status: PostStatus.Published,
      });
    });

    it('answers 409 and leaves the count alone on a second like', async () => {
      const { service, posts, likes } = setup();
      likes.create.mockRejectedValue(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );

      await expect(service.like(POST_ID, USER_ID)).rejects.toThrow(
        new ConflictException('You have already liked this post'),
      );

      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('passes on a database error that is not a duplicate', async () => {
      const { service, posts, likes } = setup();
      const failure = new Error('connection lost');
      likes.create.mockRejectedValue(failure);

      await expect(service.like(POST_ID, USER_ID)).rejects.toBe(failure);

      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('answers 404 and stores nothing when the post is missing or a draft', async () => {
      const { service, likes } = setup({ postIsPublished: false });

      await expect(service.like(POST_ID, USER_ID)).rejects.toThrow(
        new NotFoundException('Post not found'),
      );

      expect(likes.create).not.toHaveBeenCalled();
    });
  });

  describe('unlike (BLG-06)', () => {
    it('removes only the like of the logged-in user and returns the new count', async () => {
      const { service, posts, likes } = setup();
      likes.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
      posts.findOneAndUpdate.mockReturnValue(query({ likeCount: 2 }));

      const result = await service.unlike(POST_ID, USER_ID);

      expect(likes.deleteOne).toHaveBeenCalledWith({
        postId: new Types.ObjectId(POST_ID),
        userId: new Types.ObjectId(USER_ID),
      });
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: POST_ID, likeCount: { $gt: 0 } },
        { $inc: { likeCount: -1 } },
        { returnDocument: 'after' },
      );
      expect(result).toEqual({ postId: POST_ID, liked: false, likeCount: 2 });
    });

    it('answers 409 and leaves the count alone when the user has not liked the post', async () => {
      const { service, posts, likes } = setup();
      likes.deleteOne.mockReturnValue(query({ deletedCount: 0 }));

      await expect(service.unlike(POST_ID, USER_ID)).rejects.toThrow(
        new ConflictException('You have not liked this post'),
      );

      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('never takes the count below zero', async () => {
      const { service, posts, likes } = setup();
      likes.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
      // The guarded update matches nothing because the counter is already 0.
      posts.findOneAndUpdate.mockReturnValue(query(null));
      posts.findById.mockReturnValue(query({ likeCount: 0 }));

      const result = await service.unlike(POST_ID, USER_ID);

      expect(result).toEqual({ postId: POST_ID, liked: false, likeCount: 0 });
    });

    it('answers 404 and deletes nothing when the post is missing or a draft', async () => {
      const { service, likes } = setup({ postIsPublished: false });

      await expect(service.unlike(POST_ID, USER_ID)).rejects.toThrow(
        new NotFoundException('Post not found'),
      );

      expect(likes.deleteOne).not.toHaveBeenCalled();
    });
  });
});
