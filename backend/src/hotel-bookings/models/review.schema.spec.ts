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

  it("has one review per reservation and the index of a hotel's reviews, newest first", () => {
    expect(ReviewSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ bookingId: 1 }, { unique: true }],
        [{ hotelId: 1, createdAt: -1 }, {}],
      ]),
    );
  });
});
