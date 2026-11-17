import { Types } from 'mongoose';
import { visiblePublishedPost } from './visible-post.filter';

const POST_ID = '6740f1c2a4b5c6d7e8f90abc';
const VIEWER_ID = '6740f1c2a4b5c6d7e8f90001';

describe('visiblePublishedPost (BLG-05, BLG-06, GEN-10)', () => {
  it('for a guest: published and not hidden', () => {
    expect(visiblePublishedPost(POST_ID)).toEqual({
      _id: POST_ID,
      status: 'published',
      moderation: { $ne: 'hidden' },
    });
  });

  it('for a logged-in user: published, and not hidden unless it is their own', () => {
    expect(visiblePublishedPost(POST_ID, VIEWER_ID)).toEqual({
      _id: POST_ID,
      status: 'published',
      $or: [
        { moderation: { $ne: 'hidden' } },
        { authorId: new Types.ObjectId(VIEWER_ID) },
      ],
    });
  });
});
