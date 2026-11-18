import { Types } from 'mongoose';
import { DELETED_USER_NAME, POST_EXCERPT_LENGTH } from '../blog.constants';
import {
  toExcerpt,
  toPostSummary,
  type PostSummarySource,
} from './post-summary.mapper';

const authorId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const source: PostSummarySource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc'),
  authorId,
  title: 'Three days in Cairo',
  body: 'Short body',
  tags: ['cairo', 'egypt'],
  publishedAt: new Date('2026-11-15T12:00:00.000+02:00'),
  likeCount: 4,
  commentCount: 2,
};
const names = new Map([[authorId.toString(), 'Sara Ahmed']]);

describe('toPostSummary (BLG-08)', () => {
  it('maps the public fields, with the author name and a UTC date', () => {
    expect(toPostSummary(source, names)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90abc',
      title: 'Three days in Cairo',
      author: { id: authorId.toString(), name: 'Sara Ahmed' },
      publishedAt: '2026-11-15T10:00:00.000Z',
      excerpt: 'Short body',
      tags: ['cairo', 'egypt'],
      likeCount: 4,
      commentCount: 2,
    });
  });

  it('leaves out the body, the status, the images and Mongo internals', () => {
    const stored = {
      ...source,
      status: 'published',
      images: ['a.png'],
      __v: 0,
    } as PostSummarySource;

    expect(Object.keys(toPostSummary(stored, names)).sort()).toEqual([
      'author',
      'commentCount',
      'excerpt',
      'id',
      'likeCount',
      'publishedAt',
      'tags',
      'title',
    ]);
  });

  it('shows "Deleted user" for an author who is not in the names', () => {
    expect(toPostSummary(source, new Map()).author).toEqual({
      id: authorId.toString(),
      name: DELETED_USER_NAME,
    });
  });

  it('counts 0 likes and comments on a post stored before the counters', () => {
    const old = { ...source, likeCount: undefined, commentCount: undefined };

    expect(toPostSummary(old, names)).toMatchObject({
      likeCount: 0,
      commentCount: 0,
    });
  });

  it('returns a copy of the tags', () => {
    expect(toPostSummary(source, names).tags).not.toBe(source.tags);
  });
});

describe('toExcerpt', () => {
  it('keeps a short body as it is', () => {
    expect(toExcerpt('A short trip.')).toBe('A short trip.');
  });

  it(`keeps a body of exactly ${POST_EXCERPT_LENGTH} characters`, () => {
    const body = 'a'.repeat(POST_EXCERPT_LENGTH);

    expect(toExcerpt(body)).toBe(body);
  });

  it('cuts a long body at the last space before the limit and adds "…"', () => {
    const body = `${'word '.repeat(60)}end`;

    const excerpt = toExcerpt(body);

    expect(excerpt.endsWith('word…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(POST_EXCERPT_LENGTH + 1);
    expect(body.startsWith(excerpt.slice(0, -1))).toBe(true);
  });

  it('cuts a long word that has no space at the limit', () => {
    const body = 'x'.repeat(POST_EXCERPT_LENGTH + 50);

    expect(toExcerpt(body)).toBe(`${'x'.repeat(POST_EXCERPT_LENGTH)}…`);
  });

  it('keeps the last word when the limit falls just before a space', () => {
    const head = `${'a'.repeat(POST_EXCERPT_LENGTH - 5)} word`;

    expect(toExcerpt(`${head} more`)).toBe(`${head}…`);
  });

  it('never splits an emoji when one long word is cut', () => {
    const body = '😀'.repeat(POST_EXCERPT_LENGTH + 10);

    expect(toExcerpt(body)).toBe(`${'😀'.repeat(POST_EXCERPT_LENGTH)}…`);
  });

  it('turns line breaks and runs of spaces into one space', () => {
    expect(toExcerpt('  Day one:\n\n  the   pyramids \t ')).toBe(
      'Day one: the pyramids',
    );
  });
});
