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

  it('accepts a rating without text and starts visible', () => {
    const doc = review();

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.moderation).toBe(ReviewModeration.Visible);
    expect(doc.text).toBeUndefined();
  });

  it('trims the text', () => {
    expect(review({ text: '  Lovely  ' }).text).toBe('Lovely');
  });

  it.each([0, 6, 4.5])('refuses the rating %s', (rating) => {
    expect(invalidPaths(review({ rating }))).toEqual(['rating']);
  });

  it('refuses a text of more than 1000 characters', () => {
    expect(invalidPaths(review({ text: 'x'.repeat(1001) }))).toEqual(['text']);
    expect(review({ text: 'x'.repeat(1000) }).validateSync()).toBeUndefined();
  });

  it('refuses an unknown moderation state', () => {
    expect(invalidPaths(review({ moderation: 'gone' }))).toEqual([
      'moderation',
    ]);
  });

  it('has one review per reservation and the newest-first index of a hotel', () => {
    expect(ReviewSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ bookingId: 1 }, expect.objectContaining({ unique: true })],
        [{ hotelId: 1, createdAt: -1 }, expect.anything()],
      ]),
    );
  });
});
