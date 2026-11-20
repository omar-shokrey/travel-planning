import { Types } from 'mongoose';
import { ReviewModeration } from '../enums/review-moderation.enum';
import { toReviewResponse, type ReviewSource } from './review.mapper';

const ID = new Types.ObjectId();
const HOTEL_ID = new Types.ObjectId();
const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

const stored = (fields: Partial<ReviewSource> = {}): ReviewSource => ({
  _id: ID,
  hotelId: HOTEL_ID,
  userId: USER_ID,
  bookingId: BOOKING_ID,
  rating: 4,
  text: 'Quiet rooms.',
  moderation: ReviewModeration.Visible,
  createdAt: new Date('2027-06-20T10:00:00.000Z'),
  updatedAt: new Date('2027-06-21T08:30:00.000Z'),
  ...fields,
});

describe('toReviewResponse (HTL-23)', () => {
  it('shows the ids, the rating, the text and the times', () => {
    expect(toReviewResponse(stored())).toEqual({
      id: ID.toString(),
      hotelId: HOTEL_ID.toString(),
      bookingId: BOOKING_ID.toString(),
      rating: 4,
      text: 'Quiet rooms.',
      createdAt: '2027-06-20T10:00:00.000Z',
      updatedAt: '2027-06-21T08:30:00.000Z',
    });
  });

  it('shows a null text when there is none, and never the author id or the moderation', () => {
    const response = toReviewResponse(stored({ text: undefined }));

    expect(response.text).toBeNull();
    const text = JSON.stringify(response);
    expect(text).not.toContain(USER_ID.toString());
    expect(text).not.toContain('moderation');
  });
});
