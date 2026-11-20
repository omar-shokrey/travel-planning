import { model, Types } from 'mongoose';
import { ReviewModeration } from '../enums/review-moderation.enum';
import { ReviewSchema } from './review.schema';

// Validation runs in memory: no database is opened.
const ReviewModel = model('ReviewSchemaSpec', ReviewSchema);

const review = (fields: Record<string, unknown> = {}) =>
  new ReviewModel({
    hotelId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    bookingId: new Types.ObjectId(),
    rating: 4,
    ...fields,
  });

const invalidPaths = (doc: ReturnType<typeof review>): string[] =>
  Object.keys(doc.validateSync()?.errors ?? {});

describe('Review schema (HTL-23)', () => {
  it('is stored in the reviews collection', () => {
    expect(ReviewModel.collection.collectionName).toBe('reviews');
  });

  it('accepts a rating without text, visible by default', () => {
    const doc = review();

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.moderation).toBe(ReviewModeration.Visible);
    expect(doc.text).toBeUndefined();
  });

  it('trims the text and keeps up to 1000 characters', () => {
    expect(review({ text: '  Lovely stay  ' }).text).toBe('Lovely stay');
    expect(review({ text: 'a'.repeat(1000) }).validateSync()).toBeUndefined();
  });

  it.each([
    ['rating', { rating: 0 }],
    ['rating', { rating: 6 }],
    ['rating', { rating: 3.5 }],
    ['text', { text: 'a'.repeat(1001) }],
    ['moderation', { moderation: 'deleted' }],
    ['bookingId', { bookingId: undefined }],
  ])('refuses a wrong %s', (path, fields) => {
    expect(invalidPaths(review(fields))).toContain(path);
  });

  it("has one review per reservation and the index of a hotel's reviews, newest first, and no other index", () => {
    expect(ReviewSchema.indexes()).toEqual([
      [{ bookingId: 1 }, { unique: true }],
      [{ hotelId: 1, createdAt: -1 }, {}],
    ]);
  });
});

describe('Review schema: the reply (HTL-26)', () => {
  const reply = (fields: Record<string, unknown> = {}) => ({
    text: 'Thank you for your stay.',
    repliedAt: new Date('2027-06-22T09:15:00.000Z'),
    moderatorId: new Types.ObjectId(),
    ...fields,
  });

  it('has no reply by default', () => {
    expect(review().reply).toBeUndefined();
  });

  it('keeps a reply with its text, time and moderator, trims the text and has no _id of its own', () => {
    const moderatorId = new Types.ObjectId();
    const doc = review({ reply: reply({ text: '  Thanks!  ', moderatorId }) });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.reply?.text).toBe('Thanks!');
    expect(doc.reply?.repliedAt.toISOString()).toBe('2027-06-22T09:15:00.000Z');
    expect(doc.reply?.moderatorId.toString()).toBe(moderatorId.toString());
    expect(doc.toObject().reply).not.toHaveProperty('_id');
  });

  it('accepts a reply of 1 and of 1000 characters', () => {
    expect(
      review({ reply: reply({ text: 'a' }) }).validateSync(),
    ).toBeUndefined();
    expect(
      review({ reply: reply({ text: 'a'.repeat(1000) }) }).validateSync(),
    ).toBeUndefined();
  });

  it.each([
    ['a text of 1001 characters', 'reply.text', { text: 'a'.repeat(1001) }],
    ['a text of spaces only', 'reply.text', { text: '   ' }],
    ['no text', 'reply.text', { text: undefined }],
    ['no time', 'reply.repliedAt', { repliedAt: undefined }],
    ['no moderator', 'reply.moderatorId', { moderatorId: undefined }],
  ])('refuses a reply with %s (%s)', (_label, path, fields) => {
    expect(invalidPaths(review({ reply: reply(fields) }))).toContain(path);
  });
});
