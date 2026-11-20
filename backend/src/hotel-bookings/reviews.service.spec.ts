import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelsService } from '../hotels/hotels.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReviewModeration } from './enums/review-moderation.enum';
import {
  RATING_RECOMPUTE_ATTEMPTS,
  REVIEW_EXISTS_MESSAGE,
  REVIEW_NOT_COMPLETED_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_UPDATE_EMPTY_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { ReviewsService } from './reviews.service';

const USER_ID = new Types.ObjectId();
const HOTEL_ID = new Types.ObjectId();
const BOOKING_ID = new Types.ObjectId();
const REVIEW_ID = new Types.ObjectId();
const NOW = new Date('2027-06-20T10:00:00.000Z');

const storedReview = (fields: Record<string, unknown> = {}) => ({
  _id: REVIEW_ID,
  hotelId: HOTEL_ID,
  userId: USER_ID,
  bookingId: BOOKING_ID,
  rating: 4,
  text: 'Quiet rooms.',
  moderation: ReviewModeration.Visible,
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

const duplicateKey = () =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

interface Chain {
  select: jest.Mock<Chain, []>;
  lean: jest.Mock<Chain, []>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const query = (result: unknown): Chain => {
  const chain: Chain = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(() =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result),
    ),
  };
  return chain;
};

function setup(
  options: {
    booking?: unknown;
    exists?: boolean;
    created?: unknown;
    /** What each aggregation of the rating returns, in order. */
    ratings?: { count: number; average: number }[][];
  } = {},
) {
  const ratings = [...(options.ratings ?? [[{ count: 1, average: 4 }]])];
  const lastRating = ratings[ratings.length - 1];
  const reviews = {
    exists: jest.fn(() => ({
      exec: jest
        .fn()
        .mockResolvedValue(options.exists ? { _id: REVIEW_ID } : null),
    })),
    create: jest.fn((doc: Record<string, unknown>) =>
      options.created instanceof Error
        ? Promise.reject(options.created)
        : Promise.resolve({
            toObject: () => storedReview({ ...doc, _id: REVIEW_ID }),
          }),
    ),
    findOneAndUpdate: jest.fn((..._args: unknown[]) =>
      query(storedReview({ rating: 2 })),
    ),
    findOneAndDelete: jest.fn(() => query(storedReview())),
    aggregate: jest.fn(() => ({
      exec: jest.fn(() => Promise.resolve(ratings.shift() ?? lastRating)),
    })),
  };
  const bookings = {
    findOne: jest.fn(() =>
      query(
        options.booking === undefined
          ? {
              _id: BOOKING_ID,
              hotelId: HOTEL_ID,
              status: HotelBookingStatus.Completed,
            }
          : options.booking,
      ),
    ),
  };
  const hotels = {
    setRating: jest.fn<Promise<void>, unknown[]>(() => Promise.resolve()),
  };
  const service = new ReviewsService(
    reviews as never,
    bookings as never,
    hotels as unknown as HotelsService,
  );
  return { service, reviews, bookings, hotels };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ReviewsService.create (HTL-23)', () => {
  it("rates the user's own completed reservation and stores the hotel's new rating", async () => {
    const { service, bookings, reviews, hotels } = setup();

    const response = await service.create(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      { rating: 4, text: 'Quiet rooms.' },
    );

    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER_ID,
    });
    expect(reviews.create).toHaveBeenCalledWith({
      hotelId: HOTEL_ID,
      userId: USER_ID,
      bookingId: BOOKING_ID,
      rating: 4,
      text: 'Quiet rooms.',
    });
    expect(hotels.setRating).toHaveBeenCalledWith(HOTEL_ID, {
      ratingCount: 1,
      averageRating: 4,
    });
    expect(response).toMatchObject({
      id: REVIEW_ID.toString(),
      hotelId: HOTEL_ID.toString(),
      bookingId: BOOKING_ID.toString(),
      rating: 4,
    });
  });

  it('stores no text when the text is empty', async () => {
    const { service, reviews } = setup();

    await service.create(BOOKING_ID.toString(), USER_ID.toString(), {
      rating: 5,
      text: '',
    });

    expect(reviews.create.mock.calls[0][0]).not.toHaveProperty('text');
  });

  it("answers 404 for a missing reservation or someone else's", async () => {
    const { service, reviews } = setup({ booking: null });

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).rejects.toThrow(new NotFoundException(BOOKING_NOT_FOUND_MESSAGE));
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it.each([
    HotelBookingStatus.Confirmed,
    HotelBookingStatus.PendingPayment,
    HotelBookingStatus.Expired,
    HotelBookingStatus.Cancelled,
  ])('answers 409 for a %s reservation', async (status) => {
    const { service, reviews } = setup({
      booking: { _id: BOOKING_ID, hotelId: HOTEL_ID, status },
    });

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).rejects.toThrow(new ConflictException(REVIEW_NOT_COMPLETED_MESSAGE));
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('answers 409 when the reservation already has a review', async () => {
    const { service, reviews } = setup({ exists: true });

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).rejects.toThrow(new ConflictException(REVIEW_EXISTS_MESSAGE));
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('answers 409 when a review at the same moment won the unique index', async () => {
    const { service, hotels } = setup({ created: duplicateKey() });

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).rejects.toThrow(new ConflictException(REVIEW_EXISTS_MESSAGE));
    expect(hotels.setRating).not.toHaveBeenCalled();
  });

  it('rethrows another database error', async () => {
    const down = new Error('database down');
    const { service } = setup({ created: down });

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).rejects.toBe(down);
  });
});

describe('ReviewsService.update (HTL-23)', () => {
  it("changes the author's own review and stores the hotel's new rating", async () => {
    const { service, reviews, hotels } = setup();

    const response = await service.update(
      REVIEW_ID.toString(),
      USER_ID.toString(),
      { rating: 2 },
    );

    expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: REVIEW_ID.toString(), userId: USER_ID },
      { $set: { rating: 2 } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(hotels.setRating).toHaveBeenCalledTimes(1);
    expect(response.rating).toBe(2);
  });

  it('removes the text when an empty text is sent', async () => {
    const { service, reviews } = setup();

    await service.update(REVIEW_ID.toString(), USER_ID.toString(), {
      text: '',
    });

    expect(reviews.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $unset: { text: '' },
    });
  });

  it('answers 400 when nothing is sent', async () => {
    const { service, reviews } = setup();

    await expect(
      service.update(REVIEW_ID.toString(), USER_ID.toString(), {}),
    ).rejects.toThrow(new BadRequestException(REVIEW_UPDATE_EMPTY_MESSAGE));
    expect(reviews.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's review or a missing one, and stores no rating", async () => {
    const { service, reviews, hotels } = setup();
    reviews.findOneAndUpdate.mockReturnValueOnce(query(null));

    await expect(
      service.update(REVIEW_ID.toString(), USER_ID.toString(), { rating: 2 }),
    ).rejects.toThrow(new NotFoundException(REVIEW_NOT_FOUND_MESSAGE));
    expect(hotels.setRating).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.remove (HTL-23)', () => {
  it("deletes the author's own review and stores the hotel's new rating", async () => {
    const { service, reviews, hotels } = setup({ ratings: [[]] });

    await service.remove(REVIEW_ID.toString(), USER_ID.toString());

    expect(reviews.findOneAndDelete).toHaveBeenCalledWith({
      _id: REVIEW_ID.toString(),
      userId: USER_ID,
    });
    // No visible review left: 0 ratings, average 0.
    expect(hotels.setRating).toHaveBeenCalledWith(HOTEL_ID, {
      ratingCount: 0,
      averageRating: 0,
    });
  });

  it("answers 404 for someone else's review or a missing one", async () => {
    const { service, reviews, hotels } = setup();
    reviews.findOneAndDelete.mockReturnValueOnce(query(null));

    await expect(
      service.remove(REVIEW_ID.toString(), USER_ID.toString()),
    ).rejects.toThrow(new NotFoundException(REVIEW_NOT_FOUND_MESSAGE));
    expect(hotels.setRating).not.toHaveBeenCalled();
  });
});

describe("ReviewsService: the hotel's rating (HTL-23)", () => {
  it('aggregates only the visible reviews of the hotel and rounds the average to two decimals', async () => {
    const { service, reviews } = setup({
      ratings: [[{ count: 3, average: 13 / 3 }]],
    });

    await expect(service.ratingOf(HOTEL_ID)).resolves.toEqual({
      ratingCount: 3,
      averageRating: 4.33,
    });
    expect(reviews.aggregate).toHaveBeenCalledWith([
      { $match: { hotelId: HOTEL_ID, moderation: ReviewModeration.Visible } },
      {
        $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } },
      },
    ]);
  });

  it('stores it again when another change moved it in between, until it is stable', async () => {
    const { service, hotels } = setup({
      ratings: [
        [{ count: 1, average: 4 }],
        [{ count: 2, average: 3 }],
        [{ count: 2, average: 3 }],
      ],
    });

    await service.create(BOOKING_ID.toString(), USER_ID.toString(), {
      rating: 4,
    });

    expect(hotels.setRating.mock.calls).toEqual([
      [HOTEL_ID, { ratingCount: 1, averageRating: 4 }],
      [HOTEL_ID, { ratingCount: 2, averageRating: 3 }],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it(`stores the newest value once more after ${RATING_RECOMPUTE_ATTEMPTS} tries when it keeps moving, and warns`, async () => {
    const { service, hotels } = setup({
      ratings: Array.from({ length: 10 }, (_, i) => [
        { count: i + 1, average: 4 },
      ]),
    });

    await service.create(BOOKING_ID.toString(), USER_ID.toString(), {
      rating: 4,
    });

    expect(hotels.setRating).toHaveBeenCalledTimes(
      RATING_RECOMPUTE_ATTEMPTS + 1,
    );
    // The last store is the newest value read, never an older one.
    expect(hotels.setRating.mock.calls.at(-1)).toEqual([
      HOTEL_ID,
      { ratingCount: RATING_RECOMPUTE_ATTEMPTS + 1, averageRating: 4 },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the review when storing the rating fails: it is logged', async () => {
    const { service, hotels } = setup();
    hotels.setRating.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      service.create(BOOKING_ID.toString(), USER_ID.toString(), { rating: 4 }),
    ).resolves.toMatchObject({ rating: 4 });
    expect(error).toHaveBeenCalledTimes(1);
  });
});
