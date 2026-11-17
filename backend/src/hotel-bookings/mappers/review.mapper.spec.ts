import { Types } from 'mongoose';
import { ReviewModeration } from '../enums/review-moderation.enum';
import { toReviewResponse, type ReviewSource } from './review.mapper';

const id = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const bookingId = new Types.ObjectId();

const review = (fields: Partial<ReviewSource> = {}): ReviewSource => ({
  _id: id,
  hotelId,
  userId: new Types.ObjectId(),
  bookingId,
  rating: 4,
  text: 'Quiet rooms.',
  moderation: ReviewModeration.Visible,
  createdAt: new Date('2026-12-15T09:30:00.000Z'),
  updatedAt: new Date('2026-12-16T10:00:00.000Z'),
  ...fields,
});

describe('toReviewResponse (HTL-23, HTL-24)', () => {
  it('returns the public fields with the author by name', () => {
    expect(toReviewResponse(review(), 'Sara Ahmed')).toEqual({
      id: id.toString(),
      hotelId: hotelId.toString(),
      bookingId: bookingId.toString(),
      rating: 4,
      text: 'Quiet rooms.',
      authorName: 'Sara Ahmed',
      createdAt: '2026-12-15T09:30:00.000Z',
      updatedAt: '2026-12-16T10:00:00.000Z',
    });
  });

  it("never returns the author's account id or the moderation state", () => {
    const response = toReviewResponse(review(), 'Sara Ahmed');

    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('moderation');
  });

  it('gives null for a missing text or author', () => {
    const response = toReviewResponse(review({ text: undefined }), null);

    expect(response.text).toBeNull();
    expect(response.authorName).toBeNull();
  });
});
