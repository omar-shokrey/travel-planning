import { Types } from 'mongoose';
import { visiblePublishedPost } from './visible-post.filter';

const POST_ID = '6740f1c2a4b5c6d7e8f90abc';
const VIEWER_ID = '6740f1c2a4b5c6d7e8f90001';
const AUTHOR_ID = '6740f1c2a4b5c6d7e8f90002';

describe('visiblePublishedPost (BLG-05, BLG-06, GEN-10)', () => {
  it('for a guest: published and not hidden', () => {
    expect(visiblePublishedPost(POST_ID)).toEqual({
      _id: POST_ID,
      status: 'published',
      authorDeactivated: { $ne: true },
      moderation: { $ne: 'hidden' },
    });
  });

  it('for a logged-in user: published, and not hidden unless it is their own', () => {
    expect(visiblePublishedPost(POST_ID, VIEWER_ID)).toEqual({
      _id: POST_ID,
      status: 'published',
      authorDeactivated: { $ne: true },
      $or: [
        { moderation: { $ne: 'hidden' } },
        { authorId: new Types.ObjectId(VIEWER_ID) },
      ],
    });
  });

  it.each([
    ['a guest', undefined],
    ['a logged-in user', VIEWER_ID],
    ['the author', AUTHOR_ID],
  ])(
    'leaves out the post of a deactivated author for %s (ACC-12)',
    (_label, viewerId) => {
      const filter = visiblePublishedPost(POST_ID, viewerId);

      // At the top level, outside the author's own `$or`: nobody sees it.
      expect(filter.authorDeactivated).toEqual({ $ne: true });
    },
  );
});
