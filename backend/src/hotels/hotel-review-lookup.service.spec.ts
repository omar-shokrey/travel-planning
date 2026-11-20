import { DECORATORS } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ReviewModeration } from '../hotel-bookings/enums/review-moderation.enum';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX_LENGTH,
} from '../hotel-bookings/hotel-bookings.constants';
import { ReviewSchema } from '../hotel-bookings/models/review.schema';
import { HotelReviewResponseDto } from './dto/hotel-review-response.dto';
import { HotelReviewLookup } from './hotel-review-lookup.service';
import {
  REVIEWS_COLLECTION,
  VISIBLE_REVIEW_MODERATION,
} from './hotels.constants';

const HOTEL_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

const build = (page: unknown[] = [], total = page.length) => {
  const cursor = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    toArray: jest.fn().mockResolvedValue(page),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.skip.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  const collection = {
    find: jest.fn().mockReturnValue(cursor),
    countDocuments: jest.fn().mockResolvedValue(total),
    // Any write method called by mistake fails the test.
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    createIndex: jest.fn(),
  };
  const connection = { collection: jest.fn().mockReturnValue(collection) };
  return {
    lookup: new HotelReviewLookup(connection as never),
    collection,
    cursor,
    connection,
  };
};

describe('HotelReviewLookup constants (HTL-24)', () => {
  it('names the collection of the Review schema of hotel-bookings', () => {
    expect(ReviewSchema.get('collection')).toBe(REVIEWS_COLLECTION);
  });

  it('uses the moderation value of a visible review', () => {
    expect(VISIBLE_REVIEW_MODERATION).toBe(ReviewModeration.Visible);
  });

  it('documents the rating and text limits of hotel-bookings in the response', () => {
    const swaggerOf = (field: string) =>
      Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        HotelReviewResponseDto.prototype,
        field,
      ) as Record<string, unknown>;

    expect(swaggerOf('rating')).toMatchObject({
      minimum: REVIEW_RATING_MIN,
      maximum: REVIEW_RATING_MAX,
    });
    expect(swaggerOf('text')).toMatchObject({
      maxLength: REVIEW_TEXT_MAX_LENGTH,
    });
  });
});

describe('HotelReviewLookup.listVisibleForHotel (HTL-24)', () => {
  it('reads one page of the visible reviews of the hotel, newest first, and counts with the same filter', async () => {
    const page = [{ _id: new Types.ObjectId() }];
    const { lookup, collection, cursor, connection } = build(page, 12);

    const result = await lookup.listVisibleForHotel(HOTEL_ID, {
      skip: 10,
      limit: 10,
    });

    const filter = { hotelId: HOTEL_ID, moderation: 'visible' };
    expect(connection.collection).toHaveBeenCalledWith('reviews');
    expect(collection.find).toHaveBeenCalledWith(filter, expect.anything());
    expect(collection.countDocuments).toHaveBeenCalledWith(filter);
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(cursor.skip).toHaveBeenCalledWith(10);
    expect(cursor.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({ items: page, total: 12 });
  });

  it('reads only the listed fields: no booking id, moderation or update time', async () => {
    const { lookup, collection } = build();

    await lookup.listVisibleForHotel(HOTEL_ID, { skip: 0, limit: 10 });

    expect(collection.find).toHaveBeenCalledWith(expect.anything(), {
      projection: { userId: 1, rating: 1, text: 1, createdAt: 1 },
    });
  });

  it('never writes and creates no index', async () => {
    const { lookup, collection } = build();

    await lookup.listVisibleForHotel(HOTEL_ID, { skip: 0, limit: 10 });

    for (const method of [
      'insertOne',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
      'findOneAndUpdate',
      'createIndex',
    ] as const) {
      expect(collection[method]).not.toHaveBeenCalled();
    }
  });
});
