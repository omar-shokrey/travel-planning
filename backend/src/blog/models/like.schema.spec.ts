import { Mongoose, Types } from 'mongoose';
import { Like, LikeSchema } from './like.schema';

// Validation runs in memory: no database is opened.
const LikeModel = new Mongoose().model(Like.name, LikeSchema);

describe('LikeSchema (BLG-06)', () => {
  it('is stored in the likes collection', () => {
    expect(LikeModel.collection.collectionName).toBe('likes');
  });

  it('accepts a like of one user on one post', () => {
    const like = new LikeModel({
      postId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
    });

    expect(like.validateSync()).toBeUndefined();
  });

  it('requires the post and the user', () => {
    const errors = new LikeModel({}).validateSync()?.errors ?? {};

    expect(Object.keys(errors).sort()).toEqual(['postId', 'userId']);
  });

  it('lets a user like a post only once, through a unique index', () => {
    expect(LikeSchema.indexes()).toContainEqual([
      { postId: 1, userId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
