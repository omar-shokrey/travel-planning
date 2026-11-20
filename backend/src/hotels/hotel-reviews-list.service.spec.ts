import { NotFoundException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { UsersService } from '../users/users.service';
import type {
  HotelReviewLookup,
  HotelReviewRecord,
} from './hotel-review-lookup.service';
import { HotelReviewsListService } from './hotel-reviews-list.service';
import type { Hotel } from './models/hotel.schema';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const MONA = new Types.ObjectId('6740f1c2a4b5c6d7e8f90a01');
const GONE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90a02');

const record = (
  userId: Types.ObjectId,
  rating: number,
  createdAt: string,
): HotelReviewRecord => ({
  _id: new Types.ObjectId(),
  userId,
  rating,
  createdAt: new Date(createdAt),
});

const page = (pageNumber = 1, limit = 10) =>
  ({
    page: pageNumber,
    limit,
    skip: (pageNumber - 1) * limit,
  }) as PaginationQueryDto;

const setUp = (
  hotelExists: boolean,
  items: HotelReviewRecord[] = [],
  total = items.length,
  names = new Map<string, string>(),
) => {
  const exec = jest
    .fn()
    .mockResolvedValue(
      hotelExists ? { _id: new Types.ObjectId(HOTEL_ID) } : null,
    );
  const hotels = { exists: jest.fn(() => ({ exec })) };
  const reviews = {
    listVisibleForHotel: jest.fn().mockResolvedValue({ items, total }),
  };
  const users = { findNamesByIds: jest.fn().mockResolvedValue(names) };
  const service = new HotelReviewsListService(
    hotels as unknown as Model<Hotel>,
    reviews as unknown as HotelReviewLookup,
    users as unknown as UsersService,
  );
  return { service, hotels, reviews, users };
};

describe('HotelReviewsListService (HTL-24)', () => {
  it('lists one page of the reviews of an active hotel, with the names of the page', async () => {
    const items = [
      record(MONA, 5, '2026-11-10T09:00:00.000Z'),
      record(GONE, 2, '2026-11-01T09:00:00.000Z'),
    ];
    const { service, hotels, reviews, users } = setUp(
      true,
      items,
      12,
      new Map([[MONA.toString(), 'Mona']]),
    );

    const result = await service.list(HOTEL_ID, page(2, 2));

    expect(hotels.exists).toHaveBeenCalledWith({
      _id: new Types.ObjectId(HOTEL_ID),
      active: true,
    });
    expect(reviews.listVisibleForHotel).toHaveBeenCalledWith(
      new Types.ObjectId(HOTEL_ID),
      { skip: 2, limit: 2 },
    );
    expect(users.findNamesByIds).toHaveBeenCalledTimes(1);
    expect(users.findNamesByIds).toHaveBeenCalledWith([MONA, GONE]);
    expect(result.items.map((item) => item.authorName)).toEqual([
      'Mona',
      'Deleted user',
    ]);
    expect(result.items.map((item) => item.rating)).toEqual([5, 2]);
    expect(result.meta).toEqual({
      page: 2,
      limit: 2,
      total: 12,
      totalPages: 6,
    });
  });

  it('answers an empty page for a hotel with no review', async () => {
    const { service } = setUp(true);

    await expect(service.list(HOTEL_ID, page())).resolves.toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('answers 404 "Hotel not found" for a missing or deactivated hotel, and reads no review', async () => {
    const { service, reviews, users } = setUp(false);

    await expect(service.list(HOTEL_ID, page())).rejects.toThrow(
      new NotFoundException('Hotel not found'),
    );
    expect(reviews.listVisibleForHotel).not.toHaveBeenCalled();
    expect(users.findNamesByIds).not.toHaveBeenCalled();
  });
});
