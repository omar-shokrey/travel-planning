import { Types } from 'mongoose';
import type { HotelReviewRecord } from '../hotel-review-lookup.service';
import { toHotelReviewResponse } from './hotel-review.mapper';

const AUTHOR = new Types.ObjectId('6740f1c2a4b5c6d7e8f90a01');
const review = (
  change: Partial<HotelReviewRecord> = {},
): HotelReviewRecord => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
  userId: AUTHOR,
  rating: 4,
  text: 'Quiet rooms.',
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  ...change,
});
const names = new Map([[AUTHOR.toString(), 'Sara Ahmed']]);

describe('toHotelReviewResponse (HTL-24)', () => {
  it('maps the id, the rating, the text, the author name and the UTC time', () => {
    expect(toHotelReviewResponse(review(), names)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90789',
      rating: 4,
      text: 'Quiet rooms.',
      authorName: 'Sara Ahmed',
      createdAt: '2026-11-05T11:00:00.000Z',
    });
  });

  it('leaves the text out when the review has none', () => {
    const mapped = toHotelReviewResponse(review({ text: undefined }), names);

    expect(mapped).not.toHaveProperty('text');
  });

  it('leaves an empty text out too', () => {
    expect(
      toHotelReviewResponse(review({ text: '' }), names),
    ).not.toHaveProperty('text');
  });

  it('shows "Deleted user" for an author who is not in the names', () => {
    expect(toHotelReviewResponse(review(), new Map()).authorName).toBe(
      'Deleted user',
    );
  });

  it("never returns the author's account id", () => {
    const mapped = toHotelReviewResponse(review(), names);

    expect(Object.keys(mapped).sort()).toEqual(
      ['authorName', 'createdAt', 'id', 'rating', 'text'].sort(),
    );
    expect(JSON.stringify(mapped)).not.toContain(AUTHOR.toString());
  });
});
