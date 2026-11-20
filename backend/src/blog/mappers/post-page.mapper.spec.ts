import { Types } from 'mongoose';
import { DELETED_USER_NAME } from '../blog.constants';
import {
  toPostPage,
  type PostCommentSource,
  type PostPageSource,
} from './post-page.mapper';

const POST_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
const SARA = new Types.ObjectId('6740f1c2a4b5c6d7e8f90001');
const OMAR = new Types.ObjectId('6740f1c2a4b5c6d7e8f90002');
const GONE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90003');

const names = new Map([
  [SARA.toString(), 'Sara Ahmed'],
  [OMAR.toString(), 'Omar Ali'],
]);
const pagination = { page: 1, limit: 10 };

const post = (overrides: Partial<PostPageSource> = {}): PostPageSource => ({
  _id: POST_ID,
  authorId: SARA,
  title: 'Three days in Cairo',
  body: 'I spent three amazing days exploring Cairo.\nThe first morning…',
  tags: ['cairo', 'egypt'],
  images: ['a.jpg', 'b.png'],
  publishedAt: new Date('2026-11-15T10:00:00.000Z'),
  likeCount: 4,
  commentCount: 2,
  ...overrides,
});

const comment = (
  id: string,
  authorId: Types.ObjectId,
  overrides: Partial<PostCommentSource> = {},
): PostCommentSource => ({
  _id: new Types.ObjectId(id),
  authorId,
  body: 'Great tips!',
  createdAt: new Date('2026-11-15T11:00:00.000Z'),
  updatedAt: new Date('2026-11-15T12:30:00.000Z'),
  ...overrides,
});

describe('toPostPage (BLG-02)', () => {
  it('shows the post with its author, date, body, tags, images and counters', () => {
    const page = toPostPage(post(), [], 0, pagination, names);

    expect(page).toEqual({
      id: POST_ID.toString(),
      title: 'Three days in Cairo',
      author: { id: SARA.toString(), name: 'Sara Ahmed' },
      publishedAt: '2026-11-15T10:00:00.000Z',
      body: 'I spent three amazing days exploring Cairo.\nThe first morning…',
      tags: ['cairo', 'egypt'],
      images: ['a.jpg', 'b.png'],
      likeCount: 4,
      commentCount: 2,
      itinerary: null,
      comments: {
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    });
  });

  it('has exactly the documented keys and none of the left-out ones', () => {
    const stored = {
      ...post(),
      // What a stored post carries, which must never reach the page.
      status: 'published',
      moderation: 'visible',
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
      updatedAt: new Date('2026-11-16T10:00:00.000Z'),
    };

    const page = toPostPage(stored, [], 0, pagination, names);

    expect(Object.keys(page).sort()).toEqual([
      'author',
      'body',
      'commentCount',
      'comments',
      'id',
      'images',
      'itinerary',
      'likeCount',
      'publishedAt',
      'tags',
      'title',
    ]);
    for (const left of [
      'status',
      'moderation',
      'authorId',
      'createdAt',
      'updatedAt',
    ]) {
      expect(page).not.toHaveProperty(left);
    }
    expect(Object.keys(page.author).sort()).toEqual(['id', 'name']);
  });

  it('shows each comment with its author and dates, and nothing else', () => {
    const stored = {
      ...comment('6740a1b2c3d4e5f601234567', OMAR),
      // What a stored comment carries, which must never reach the page.
      postId: POST_ID,
      moderation: 'visible',
    };

    const page = toPostPage(post(), [stored], 1, pagination, names);

    expect(page.comments.items).toEqual([
      {
        id: '6740a1b2c3d4e5f601234567',
        author: { id: OMAR.toString(), name: 'Omar Ali' },
        body: 'Great tips!',
        createdAt: '2026-11-15T11:00:00.000Z',
        updatedAt: '2026-11-15T12:30:00.000Z',
      },
    ]);
    expect(Object.keys(page.comments.items[0]).sort()).toEqual([
      'author',
      'body',
      'createdAt',
      'id',
      'updatedAt',
    ]);
  });

  it('keeps the order of the comments it is given', () => {
    const first = comment('6740a1b2c3d4e5f601234561', SARA, { body: 'First' });
    const second = comment('6740a1b2c3d4e5f601234562', OMAR, {
      body: 'Second',
    });

    const page = toPostPage(post(), [first, second], 2, pagination, names);

    expect(page.comments.items.map((item) => item.body)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('builds the comments meta from the counted total, not from the stored counter', () => {
    const page = toPostPage(
      post({ commentCount: 99 }),
      [comment('6740a1b2c3d4e5f601234561', SARA)],
      12,
      { page: 2, limit: 5 },
      names,
    );

    expect(page.commentCount).toBe(99);
    expect(page.comments.meta).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
  });

  it('writes every moment as a UTC ISO string', () => {
    const page = toPostPage(
      post({ publishedAt: new Date('2026-11-15T23:59:59.123Z') }),
      [comment('6740a1b2c3d4e5f601234561', SARA)],
      1,
      pagination,
      names,
    );

    expect(page.publishedAt).toBe('2026-11-15T23:59:59.123Z');
    for (const value of [
      page.publishedAt,
      page.comments.items[0].createdAt,
      page.comments.items[0].updatedAt,
    ]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('shows "Deleted user" for a post author and a commenter that have no name to show', () => {
    const page = toPostPage(
      post({ authorId: GONE }),
      [comment('6740a1b2c3d4e5f601234561', GONE)],
      1,
      pagination,
      names,
    );

    expect(page.author).toEqual({
      id: GONE.toString(),
      name: DELETED_USER_NAME,
    });
    expect(page.comments.items[0].author).toEqual({
      id: GONE.toString(),
      name: DELETED_USER_NAME,
    });
  });

  it('shows 0 for counters a post stored before they existed does not have', () => {
    const page = toPostPage(
      post({ likeCount: undefined, commentCount: undefined }),
      [],
      0,
      pagination,
      names,
    );

    expect(page.likeCount).toBe(0);
    expect(page.commentCount).toBe(0);
  });

  it('shows empty lists for tags and images a post stored before they existed does not have', () => {
    const page = toPostPage(
      post({ tags: undefined, images: undefined }),
      [],
      0,
      pagination,
      names,
    );

    expect(page.tags).toEqual([]);
    expect(page.images).toEqual([]);
  });

  it('copies the lists, so changing the answer cannot change the source', () => {
    const source = post();

    const page = toPostPage(source, [], 0, pagination, names);
    page.tags.push('changed');
    page.images.push('changed.jpg');

    expect(source.tags).toEqual(['cairo', 'egypt']);
    expect(source.images).toEqual(['a.jpg', 'b.png']);
  });

  describe('the attached itinerary (BLG-13)', () => {
    const summary = {
      id: '6741c0ffee0ddba11ad0b0b0',
      title: 'Ten days in Egypt',
      countries: ['EG'],
      startDate: '2026-12-20',
      dayCount: 10,
    };

    it('shows its summary, and exactly these keys', () => {
      const leaky = {
        ...summary,
        // What an itinerary carries, which must never reach the page.
        ownerId: 'someone',
        days: [{ linkedBookings: [{ reference: 'FB-7KQ2MX' }] }],
        budgetSubtotal: [{ amount: 1, currency: 'USD' }],
      };

      const page = toPostPage(post(), [], 0, pagination, names, leaky);

      expect(page.itinerary).toEqual(summary);
      expect(Object.keys(page.itinerary ?? {}).sort()).toEqual([
        'countries',
        'dayCount',
        'id',
        'startDate',
        'title',
      ]);
      expect(JSON.stringify(page)).not.toContain('FB-7KQ2MX');
    });

    it('shows null when there is none to show', () => {
      expect(
        toPostPage(post(), [], 0, pagination, names, null).itinerary,
      ).toBeNull();
      expect(toPostPage(post(), [], 0, pagination, names).itinerary).toBeNull();
    });
  });
});
