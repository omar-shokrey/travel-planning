import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { HotelsService } from '../hotels/hotels.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReviewModeration } from './enums/review-moderation.enum';
import {
  ALREADY_REVIEWED_MESSAGE,
  EMPTY_UPDATE_MESSAGE,
  isCompletedStay,
  NOT_COMPLETED_MESSAGE,
  ReviewsService,
  roundRating,
} from './reviews.service';

const USER = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const BOOKING = new Types.ObjectId();
const REVIEW = new Types.ObjectId();
const TODAY = '2026-11-17';

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const storedReview = (fields: object = {}) => ({
  _id: REVIEW,
  hotelId: HOTEL,
  userId: USER,
  bookingId: BOOKING,
  rating: 4,
  text: 'Quiet rooms.',
  moderation: ReviewModeration.Visible,
  createdAt: new Date('2026-12-15T09:30:00.000Z'),
  updatedAt: new Date('2026-12-15T09:30:00.000Z'),
  ...fields,
});

const setup = (
  options: {
    booking?: object | null;
    review?: object | null;
    createError?: unknown;
    updated?: object | null;
    summary?: { count: number; average: number }[];
    hotel?: object;
    listed?: object[];
    total?: number;
  } = {},
) => {
  const listChain = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(options.listed ?? []),
  };
  for (const step of ['sort', 'skip', 'limit', 'lean'] as const) {
    listChain[step].mockReturnValue(listChain);
  }
  const booking =
    options.booking === undefined
      ? {
          _id: BOOKING,
          userId: USER,
          hotelId: HOTEL,
          status: HotelBookingStatus.Completed,
          checkOut: '2026-11-10',
        }
      : options.booking;
  const bookings = { findById: jest.fn().mockReturnValue(query(booking)) };
  const reviewFound =
    options.review === undefined ? storedReview() : options.review;
  const reviews = {
    create: jest.fn((fields: object) =>
      options.createError
        ? Promise.reject(options.createError)
        : Promise.resolve({ toObject: () => storedReview(fields) }),
    ),
    findById: jest.fn().mockReturnValue(query(reviewFound)),
    find: jest.fn().mockReturnValue(listChain),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(options.total ?? 0),
    }),
    findOneAndUpdate: jest.fn().mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve(
            options.updated === undefined
              ? storedReview({ rating: 2 })
              : options.updated,
          ),
      }),
    }),
    deleteOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    }),
    aggregate: jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(options.summary ?? [{ count: 3, average: 13 / 3 }]),
    }),
  };
  const users = {
    find: jest.fn().mockReturnValue(query([{ _id: USER, name: 'Sara Ahmed' }])),
  };
  const hotels = {
    setRating: jest.fn().mockResolvedValue(undefined),
    findEntityOrThrow: jest
      .fn()
      .mockResolvedValue(options.hotel ?? { _id: HOTEL, active: true }),
  };
  const service = new ReviewsService(
    reviews as never,
    bookings as never,
    users as never,
    hotels as unknown as HotelsService,
  );
  return { service, reviews, bookings, users, hotels, listChain };
};

describe('isCompletedStay (HTL-23)', () => {
  it('accepts a completed stay', () => {
    expect(
      isCompletedStay(
        { status: HotelBookingStatus.Completed, checkOut: '2026-11-20' },
        TODAY,
      ),
    ).toBe(true);
  });

  it('accepts a confirmed stay once the check-out date has passed', () => {
    const stay = (checkOut: string) => ({
      status: HotelBookingStatus.Confirmed,
      checkOut,
    });

    expect(isCompletedStay(stay('2026-11-16'), TODAY)).toBe(true);
    expect(isCompletedStay(stay('2026-11-17'), TODAY)).toBe(false);
  });

  it.each([
    HotelBookingStatus.PendingPayment,
    HotelBookingStatus.Expired,
    HotelBookingStatus.Cancelled,
  ])('refuses a %s reservation, even after its dates', (status) => {
    expect(isCompletedStay({ status, checkOut: '2026-01-01' }, TODAY)).toBe(
      false,
    );
  });
});

describe('roundRating', () => {
  it('keeps two decimals', () => {
    expect(roundRating(13 / 3)).toBe(4.33);
    expect(roundRating(4.666)).toBe(4.67);
    expect(roundRating(5)).toBe(5);
  });
});

describe('ReviewsService (HTL-23)', () => {
  describe('create', () => {
    it('saves the review of the own completed stay and recalculates the hotel', async () => {
      const { service, reviews, hotels } = setup();

      const response = await service.create(
        BOOKING.toString(),
        USER.toString(),
        { rating: 5, text: 'Great.' },
      );

      expect(reviews.create).toHaveBeenCalledWith({
        hotelId: HOTEL,
        userId: USER,
        bookingId: BOOKING,
        rating: 5,
        text: 'Great.',
      });
      expect(reviews.aggregate).toHaveBeenCalledWith([
        { $match: { hotelId: HOTEL } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            average: { $avg: '$rating' },
          },
        },
      ]);
      expect(hotels.setRating).toHaveBeenCalledWith(HOTEL, 4.33, 3);
      expect(response).toEqual(
        expect.objectContaining({
          rating: 5,
          text: 'Great.',
          authorName: 'Sara Ahmed',
          bookingId: BOOKING.toString(),
        }),
      );
    });

    it('stores no text for an empty one', async () => {
      const { service, reviews } = setup();

      await service.create(BOOKING.toString(), USER.toString(), {
        rating: 3,
        text: '',
      });

      expect(reviews.create.mock.calls[0][0]).not.toHaveProperty('text');
    });

    it('answers 404 for a missing reservation', async () => {
      const { service } = setup({ booking: null });

      await expect(
        service.create(BOOKING.toString(), USER.toString(), { rating: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("answers 403 for someone else's reservation", async () => {
      const { service, reviews } = setup();

      await expect(
        service.create(BOOKING.toString(), new Types.ObjectId().toString(), {
          rating: 3,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(reviews.create).not.toHaveBeenCalled();
    });

    it('answers 409 for a stay that is not completed', async () => {
      const { service, reviews } = setup({
        booking: {
          _id: BOOKING,
          userId: USER,
          hotelId: HOTEL,
          status: HotelBookingStatus.Confirmed,
          checkOut: '2999-01-01',
        },
      });

      await expect(
        service.create(BOOKING.toString(), USER.toString(), { rating: 3 }),
      ).rejects.toThrow(new ConflictException(NOT_COMPLETED_MESSAGE));
      expect(reviews.create).not.toHaveBeenCalled();
    });

    it('answers 409 for a second review of the same reservation', async () => {
      const { service, hotels } = setup({ createError: { code: 11000 } });

      await expect(
        service.create(BOOKING.toString(), USER.toString(), { rating: 3 }),
      ).rejects.toThrow(new ConflictException(ALREADY_REVIEWED_MESSAGE));
      expect(hotels.setRating).not.toHaveBeenCalled();
    });

    it('passes on any other error', async () => {
      const failure = new Error('database down');
      const { service } = setup({ createError: failure });

      await expect(
        service.create(BOOKING.toString(), USER.toString(), { rating: 3 }),
      ).rejects.toBe(failure);
    });
  });

  describe('update', () => {
    it('changes the rating and recalculates the hotel', async () => {
      const { service, reviews, hotels } = setup();

      const response = await service.update(
        REVIEW.toString(),
        USER.toString(),
        { rating: 2 },
      );

      expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: REVIEW, userId: USER },
        { $set: { rating: 2 } },
        { returnDocument: 'after', runValidators: true },
      );
      expect(hotels.setRating).toHaveBeenCalled();
      expect(response.rating).toBe(2);
    });

    it('removes the text for an empty one, without recalculating', async () => {
      const { service, reviews, hotels } = setup();

      await service.update(REVIEW.toString(), USER.toString(), { text: '' });

      expect(reviews.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $unset: { text: '' },
      });
      expect(hotels.setRating).not.toHaveBeenCalled();
    });

    it('does not recalculate when the rating stays the same', async () => {
      const { service, hotels } = setup();

      await service.update(REVIEW.toString(), USER.toString(), {
        rating: 4,
        text: 'Still good.',
      });

      expect(hotels.setRating).not.toHaveBeenCalled();
    });

    it('answers 400 when nothing is sent', async () => {
      const { service, reviews } = setup();

      await expect(
        service.update(REVIEW.toString(), USER.toString(), {}),
      ).rejects.toThrow(new BadRequestException(EMPTY_UPDATE_MESSAGE));
      expect(reviews.findById).not.toHaveBeenCalled();
    });

    it('answers 404 for a missing review, and when it vanished meanwhile', async () => {
      await expect(
        setup({ review: null }).service.update(
          REVIEW.toString(),
          USER.toString(),
          { rating: 2 },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup({ updated: null }).service.update(
          REVIEW.toString(),
          USER.toString(),
          { rating: 2 },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("answers 403 for someone else's review", async () => {
      const { service, reviews } = setup();

      await expect(
        service.update(REVIEW.toString(), new Types.ObjectId().toString(), {
          rating: 2,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(reviews.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the own review and recalculates the hotel', async () => {
      const { service, reviews, hotels } = setup({ summary: [] });

      await service.remove(REVIEW.toString(), USER.toString());

      expect(reviews.deleteOne).toHaveBeenCalledWith({
        _id: REVIEW,
        userId: USER,
      });
      // The last review is gone: the hotel is unrated again.
      expect(hotels.setRating).toHaveBeenCalledWith(HOTEL, 0, 0);
    });

    it("answers 403 for someone else's review and 404 for a missing one", async () => {
      await expect(
        setup().service.remove(
          REVIEW.toString(),
          new Types.ObjectId().toString(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        setup({ review: null }).service.remove(
          REVIEW.toString(),
          USER.toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('ReviewsService.findForHotel (HTL-24)', () => {
  const page = (number = 1, limit = 10) =>
    ({ page: number, limit, skip: (number - 1) * limit }) as PaginationQueryDto;

  it('reads one page of the visible reviews, newest first, with author names', async () => {
    const other = new Types.ObjectId();
    const { service, reviews, users, listChain } = setup({
      listed: [storedReview(), storedReview({ userId: other })],
      total: 12,
    });

    const result = await service.findForHotel(HOTEL.toString(), page(2, 5));

    const filter = { hotelId: HOTEL, moderation: ReviewModeration.Visible };
    expect(reviews.find).toHaveBeenCalledWith(filter);
    expect(reviews.countDocuments).toHaveBeenCalledWith(filter);
    expect(listChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(listChain.skip).toHaveBeenCalledWith(5);
    expect(listChain.limit).toHaveBeenCalledWith(5);
    expect(users.find).toHaveBeenCalledWith({ _id: { $in: [USER, other] } });
    expect(result.meta).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
    expect(result.items.map((item) => item.authorName)).toEqual([
      'Sara Ahmed',
      null,
    ]);
  });

  it('answers 404 for a deactivated hotel', async () => {
    const { service, reviews } = setup({
      hotel: { _id: HOTEL, active: false },
    });

    await expect(
      service.findForHotel(HOTEL.toString(), page()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(reviews.find).not.toHaveBeenCalled();
  });

  it('passes on the 404 of a missing hotel', async () => {
    const { service, hotels } = setup();
    hotels.findEntityOrThrow.mockRejectedValue(
      new NotFoundException('Hotel not found'),
    );

    await expect(
      service.findForHotel(HOTEL.toString(), page()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads no users for an empty page', async () => {
    const { service, users } = setup();

    const result = await service.findForHotel(HOTEL.toString(), page());

    expect(result.items).toEqual([]);
    expect(users.find).not.toHaveBeenCalled();
  });
});
