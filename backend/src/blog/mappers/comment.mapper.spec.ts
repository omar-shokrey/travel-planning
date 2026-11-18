import { Types } from 'mongoose';
import { CommentModeration } from '../models/comment-moderation.enum';
import type { CommentDocument } from '../models/comment.schema';
import { toCommentResponse } from './comment.mapper';

describe('toCommentResponse', () => {
  const id = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const authorId = new Types.ObjectId();

  const comment = {
    id: id.toString(),
    _id: id,
    postId,
    authorId,
    body: 'Great tips!',
    moderation: CommentModeration.Visible,
    createdAt: new Date('2026-11-15T10:00:00.000Z'),
    updatedAt: new Date('2026-11-15T11:30:00.000Z'),
    __v: 0,
  } as unknown as CommentDocument;

  it('returns the ids as strings and the dates as UTC ISO strings', () => {
    expect(toCommentResponse(comment)).toEqual({
      id: id.toString(),
      postId: postId.toString(),
      authorId: authorId.toString(),
      body: 'Great tips!',
      moderation: 'visible',
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T11:30:00.000Z',
    });
  });

  it('tells the author that an admin hid the comment (GEN-10)', () => {
    const hidden = {
      ...comment,
      moderation: CommentModeration.Hidden,
    } as unknown as CommentDocument;

    expect(toCommentResponse(hidden).moderation).toBe('hidden');
  });

  it('reads a comment stored before `moderation` existed as visible', () => {
    const old = {
      ...comment,
      moderation: undefined,
    } as unknown as CommentDocument;

    expect(toCommentResponse(old).moderation).toBe('visible');
  });

  it('does not leak internal fields', () => {
    const response = toCommentResponse(comment);

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
  });
});
