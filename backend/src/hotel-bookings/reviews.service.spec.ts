import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  REVIEW_REPLY_EXISTS_MESSAGE,
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

describe('ReviewsService.reply (HTL-26)', () => {
  const MODERATOR_ID = new Types.ObjectId();
  const REPLIED_AT = new Date('2027-06-22T09:15:00.000Z');

  function replySetup(
    options: {
      /** What the first read finds: the review's hotel and reply, or null. */
      found?: unknown;
      /** What HotelsService.findManagedEntityOrThrow does. */
      managed?: Error;
      matchedCount?: number;
      /** Whether the review is still visible after a lost update. */
      stillVisible?: boolean;
      /** What the read after the update finds. */
      replied?: unknown;
    } = {},
  ) {
    const reviews = {
      findOne: jest.fn((..._args: unknown[]) =>
        query(
          options.found === undefined
            ? { _id: REVIEW_ID, hotelId: HOTEL_ID }
            : options.found,
        ),
      ),
      updateOne: jest.fn((..._args: unknown[]) => ({
        exec: jest.fn().mockResolvedValue({
          matchedCount: options.matchedCount ?? 1,
          modifiedCount: options.matchedCount ?? 1,
        }),
      })),
      exists: jest.fn((..._args: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(options.stillVisible ? { _id: REVIEW_ID } : null),
      })),
      findById: jest.fn((..._args: unknown[]) =>
        query(
          options.replied === undefined
            ? storedReview({
                reply: {
                  text: 'Thank you for your stay.',
                  repliedAt: REPLIED_AT,
                  moderatorId: MODERATOR_ID,
                },
              })
            : options.replied,
        ),
      ),
      aggregate: jest.fn(),
    };
    const hotels = {
      setRating: jest.fn(),
      findManagedEntityOrThrow: jest.fn((..._args: unknown[]) =>
        options.managed
          ? Promise.reject(options.managed)
          : Promise.resolve({ _id: HOTEL_ID }),
      ),
    };
    const service = new ReviewsService(
      reviews as never,
      {} as never,
      hotels as unknown as HotelsService,
    );
    return { service, reviews, hotels };
  }

  const reply = (service: ReviewsService) =>
    service.reply(REVIEW_ID.toString(), MODERATOR_ID.toString(), {
      text: 'Thank you for your stay.',
    });

  it("stores the reply of the hotel's moderator with one conditional update and returns the review with it", async () => {
    const { service, reviews } = replySetup();

    const response = await reply(service);

    expect(reviews.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = reviews.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { reply: Record<string, unknown> } },
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      _id: REVIEW_ID.toString(),
      moderation: ReviewModeration.Visible,
      reply: { $exists: false },
    });
    expect(update.$set.reply).toEqual({
      text: 'Thank you for your stay.',
      repliedAt: expect.any(Date),
      moderatorId: MODERATOR_ID,
    });
    expect(options).toEqual({ runValidators: true, timestamps: false });
    expect(response.reply).toEqual({
      text: 'Thank you for your stay.',
      repliedAt: '2027-06-22T09:15:00.000Z',
    });
    expect(JSON.stringify(response)).not.toContain(MODERATOR_ID.toString());
  });

  it("takes the moderator id from the login and lets HotelsService check the assignment of the review's hotel", async () => {
    const { service, hotels, reviews } = replySetup();

    await reply(service);

    expect(hotels.findManagedEntityOrThrow).toHaveBeenCalledWith(
      HOTEL_ID.toString(),
      MODERATOR_ID.toString(),
    );
    const [, update] = reviews.updateOne.mock.calls[0] as [
      unknown,
      { $set: { reply: { moderatorId: Types.ObjectId } } },
    ];
    expect(update.$set.reply.moderatorId).toBeInstanceOf(Types.ObjectId);
  });

  it('answers 404 "Review not found" for a missing review, and nothing is checked or stored', async () => {
    const { service, reviews, hotels } = replySetup({ found: null });

    await expect(reply(service)).rejects.toEqual(
      new NotFoundException(REVIEW_NOT_FOUND_MESSAGE),
    );
    expect(hotels.findManagedEntityOrThrow).not.toHaveBeenCalled();
    expect(reviews.updateOne).not.toHaveBeenCalled();
  });

  it('answers the same 404 for a hidden review, because the read asks for a visible one, and nothing is checked or stored', async () => {
    const { service, reviews, hotels } = replySetup();
    // The stored review is hidden: only a read without the visible filter finds it.
    reviews.findOne.mockImplementation((...args: unknown[]) => {
      const filter = args[0] as { moderation?: ReviewModeration };
      return query(
        filter.moderation === ReviewModeration.Visible
          ? null
          : {
              _id: REVIEW_ID,
              hotelId: HOTEL_ID,
              moderation: ReviewModeration.Hidden,
            },
      );
    });

    await expect(reply(service)).rejects.toEqual(
      new NotFoundException(REVIEW_NOT_FOUND_MESSAGE),
    );
    expect(reviews.findOne).toHaveBeenCalledWith({
      _id: REVIEW_ID.toString(),
      moderation: ReviewModeration.Visible,
    });
    expect(hotels.findManagedEntityOrThrow).not.toHaveBeenCalled();
    expect(reviews.updateOne).not.toHaveBeenCalled();
  });

  it("gives another hotel's moderator the HTL-22 answer (403) and stores nothing", async () => {
    const denied = new ForbiddenException('You do not manage this hotel');
    const { service, reviews } = replySetup({ managed: denied });

    await expect(reply(service)).rejects.toBe(denied);
    expect(reviews.updateOne).not.toHaveBeenCalled();
  });

  it('answers 409 when the review already has a reply, after the hotel check, and stores nothing', async () => {
    const { service, reviews, hotels } = replySetup({
      found: { _id: REVIEW_ID, hotelId: HOTEL_ID, reply: { text: 'First' } },
    });

    await expect(reply(service)).rejects.toEqual(
      new ConflictException(REVIEW_REPLY_EXISTS_MESSAGE),
    );
    expect(hotels.findManagedEntityOrThrow).toHaveBeenCalled();
    expect(reviews.updateOne).not.toHaveBeenCalled();
  });

  it('answers 409 when another reply won between the read and the update (matchedCount 0, still visible)', async () => {
    const { service, reviews } = replySetup({
      matchedCount: 0,
      stillVisible: true,
    });

    await expect(reply(service)).rejects.toEqual(
      new ConflictException(REVIEW_REPLY_EXISTS_MESSAGE),
    );
    expect(reviews.exists).toHaveBeenCalledWith({
      _id: REVIEW_ID.toString(),
      moderation: ReviewModeration.Visible,
    });
    expect(reviews.findById).not.toHaveBeenCalled();
  });

  it('answers 404 when the review was hidden or deleted between the read and the update (matchedCount 0)', async () => {
    const { service } = replySetup({ matchedCount: 0, stillVisible: false });

    await expect(reply(service)).rejects.toEqual(
      new NotFoundException(REVIEW_NOT_FOUND_MESSAGE),
    );
  });

  it('answers 404 when the author deleted the review right after the reply', async () => {
    const { service } = replySetup({ replied: null });

    await expect(reply(service)).rejects.toEqual(
      new NotFoundException(REVIEW_NOT_FOUND_MESSAGE),
    );
  });

  it("does not recompute or store the hotel's rating", async () => {
    const { service, reviews, hotels } = replySetup();

    await reply(service);

    expect(reviews.aggregate).not.toHaveBeenCalled();
    expect(hotels.setRating).not.toHaveBeenCalled();
  });
});
