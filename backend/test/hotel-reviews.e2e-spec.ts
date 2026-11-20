import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import {
  REVIEW_EXISTS_MESSAGE,
  REVIEW_NOT_COMPLETED_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
} from './../src/hotel-bookings/hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `htl23-${randomUUID().slice(0, 8)}`;

/** A date `days` after today (UTC); negative for the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface ReviewBody {
  id: string;
  hotelId: string;
  bookingId: string;
  rating: number;
  text: string | null;
  reply: { text: string; repliedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * HTL-23 end to end, on the "-test" database: the completed reservations are
 * inserted with the model (status completed, check-out in the past), never
 * through the shared database. One hotel of its own, so its rating depends
 * on this suite only. Every record is deleted by id.
 */
describe('Hotel ratings and reviews (e2e, HTL-23)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;
  const userIds: string[] = [];
  const bookingIds: string[] = [];
  const reviewIds = new Set<string>();
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let hotelId: string;

  const http = () => request(app.getHttpServer());

  const as = <T extends { set: (k: string, v: string) => T }>(
    call: T,
    who?: string,
  ): T => {
    const cookie = who ? cookies.get(who) : undefined;
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const review = (bookingId: string, body: unknown, who = 'user') =>
    as(http().post(`/api/hotel-bookings/${bookingId}/review`), who).send(
      body as object,
    );

  const edit = (id: string, body: unknown, who = 'user') =>
    as(http().patch(`/api/reviews/${id}`), who).send(body as object);

  const remove = (id: string, who = 'user') =>
    as(http().delete(`/api/reviews/${id}`), who);

  const ratingOfHotel = async () => {
    const hotel = await hotels.findById(hotelId).lean().orFail().exec();
    return {
      ratingCount: hotel.ratingCount,
      averageRating: hotel.averageRating,
    };
  };

  /** Creates a review and remembers it for cleanup. */
  const reviewed = async (bookingId: string, body: unknown, who = 'user') => {
    const response = await review(bookingId, body, who);
    expect(response.status).toBe(201);
    const body_ = response.body as ReviewBody;
    reviewIds.add(body_.id);
    return body_;
  };

  const createActor = async (label: string, role: Role) => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(hotelId),
        },
      }),
    });
    const id = created._id.toString();
    userIds.push(id);
    ids.set(label, id);
    cookies.set(label, await sessionCookieFor(app, id));
    return id;
  };

  /** A reservation of `owner` at the suite's hotel, two rooms, stored in `status`. */
  const insert = async (
    label: string,
    owner: string,
    status: HotelBookingStatus,
  ) => {
    const past = status === HotelBookingStatus.Completed;
    const booking = await bookings.create({
      reference: `HB-R${RUN.slice(-6).toUpperCase()}${bookingIds.length + 1}`,
      userId: new Types.ObjectId(owner),
      hotelId: new Types.ObjectId(hotelId),
      checkIn: past ? day(-10) : day(10),
      checkOut: past ? day(-8) : day(12),
      nights: 2,
      status,
      currency: 'USD',
      total: 50000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '401 (Double)',
          pricePerNight: 12500,
          adults: 2,
          childAges: [],
        },
        {
          roomId: new Types.ObjectId(),
          roomLabel: '402 (Double)',
          pricePerNight: 12500,
          adults: 2,
          childAges: [],
        },
      ],
      cancellationTiers: [],
    });
    const id = booking._id.toString();
    bookingIds.push(id);
    ids.set(label, id);
    return id;
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    bookings = app.get<Model<HotelBooking>>(getModelToken(HotelBooking.name));
    reviews = app.get<Model<Review>>(getModelToken(Review.name));
    // The unique bookingId index must exist before the duplicate test.
    await reviews.init();

    const hotel = await hotels.create({
      name: `HTL-23 hotel ${RUN}`,
      addressLine: '23 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-23 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    hotelId = hotel._id.toString();

    const user = await createActor('user', Role.User);
    const other = await createActor('other', Role.User);
    await createActor('admin', Role.Admin);
    await createActor('moderator', Role.HotelModerator);

    await insert('first', user, HotelBookingStatus.Completed);
    await insert('second', other, HotelBookingStatus.Completed);
    await insert('third', user, HotelBookingStatus.Completed);
    await insert('race', user, HotelBookingStatus.Completed);
    await insert('hidden', other, HotelBookingStatus.Completed);
    await insert('confirmed', user, HotelBookingStatus.Confirmed);
    await insert('cancelled', user, HotelBookingStatus.Cancelled);
  });

  afterAll(async () => {
    if (!app) return;
    // Every review of this suite's reservations, also one a failed test left.
    for (const bookingId of bookingIds) {
      for (const { _id } of await reviews
        .find({ bookingId: new Types.ObjectId(bookingId) })
        .select('_id')
        .lean()
        .exec()) {
        reviewIds.add(_id.toString());
      }
    }
    for (const id of reviewIds) {
      await reviews.findByIdAndDelete(id).exec();
    }
    for (const id of bookingIds) {
      await bookings.findByIdAndDelete(id).exec();
    }
    if (hotelId) {
      await hotels.findByIdAndDelete(hotelId).exec();
    }
    for (const id of userIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id).exec();
    }
    await app.close();
  });

  it("rates a completed stay and updates the hotel's average and count, then edits and deletes it", async () => {
    expect(await ratingOfHotel()).toEqual({ ratingCount: 0, averageRating: 0 });

    const mine = await reviewed(ids.get('first') ?? '', {
      rating: 4,
      text: '  Quiet rooms.  ',
    });
    expect(mine).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      hotelId,
      bookingId: ids.get('first'),
      rating: 4,
      text: 'Quiet rooms.',
      reply: null,
      createdAt: expect.stringMatching(/Z$/),
      updatedAt: expect.stringMatching(/Z$/),
    });
    expect(JSON.stringify(mine)).not.toContain(ids.get('user') ?? '');
    expect(await ratingOfHotel()).toEqual({ ratingCount: 1, averageRating: 4 });

    const others = await reviewed(
      ids.get('second') ?? '',
      { rating: 2 },
      'other',
    );
    expect(others.text).toBeNull();
    expect(await ratingOfHotel()).toEqual({ ratingCount: 2, averageRating: 3 });

    // Edit: the average follows.
    const edited = await edit(mine.id, { rating: 5, text: '' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ rating: 5, text: null });
    expect(await ratingOfHotel()).toEqual({
      ratingCount: 2,
      averageRating: 3.5,
    });

    // Delete: the average follows, and the stay can be reviewed again.
    expect((await remove(mine.id)).status).toBe(204);
    reviewIds.delete(mine.id);
    expect(await ratingOfHotel()).toEqual({ ratingCount: 1, averageRating: 2 });
    const again = await reviewed(ids.get('first') ?? '', { rating: 3 });
    expect(again.bookingId).toBe(ids.get('first'));
    expect(await ratingOfHotel()).toEqual({
      ratingCount: 2,
      averageRating: 2.5,
    });
  });

  it('allows one review per reservation, whatever the number of rooms (409 for a second)', async () => {
    await reviewed(ids.get('third') ?? '', { rating: 5 });

    const second = await review(ids.get('third') ?? '', { rating: 1 });

    expect(second.status).toBe(409);
    expect(second.body.message).toBe(REVIEW_EXISTS_MESSAGE);
    expect(
      await reviews.countDocuments({
        bookingId: new Types.ObjectId(ids.get('third')),
      }),
    ).toBe(1);
  });

  it('lets the unique index decide two reviews of the same stay at the same moment: one 201, one 409', async () => {
    const answers = await Promise.all([
      review(ids.get('race') ?? '', { rating: 4 }),
      review(ids.get('race') ?? '', { rating: 2 }),
    ]);
    for (const answer of answers) {
      if (answer.status === 201) reviewIds.add((answer.body as ReviewBody).id);
    }

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(
      await reviews.countDocuments({
        bookingId: new Types.ObjectId(ids.get('race')),
      }),
    ).toBe(1);
  });

  it("leaves a hidden review out of the hotel's rating", async () => {
    const before = await ratingOfHotel();
    const hidden = await reviewed(
      ids.get('hidden') ?? '',
      { rating: 1 },
      'other',
    );
    expect((await ratingOfHotel()).ratingCount).toBe(before.ratingCount + 1);

    // Moderation hides it (a later issue); this suite's own review.
    await reviews
      .updateOne({ _id: hidden.id }, { $set: { moderation: 'hidden' } })
      .exec();
    // Any change to the hotel's reviews recomputes the rating.
    expect((await edit(hidden.id, { rating: 2 }, 'other')).status).toBe(200);

    expect(await ratingOfHotel()).toEqual(before);
  });

  it.each(['confirmed', 'cancelled'])(
    'answers 409 for a %s reservation, which is not completed',
    async (label) => {
      const response = await review(ids.get(label) ?? '', { rating: 4 });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(REVIEW_NOT_COMPLETED_MESSAGE);
    },
  );

  it("answers 404 for another user's reservation or one that does not exist", async () => {
    for (const response of [
      await review(ids.get('second') ?? '', { rating: 4 }),
      await review(new Types.ObjectId().toString(), { rating: 4 }),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    }
  });

  it.each([
    [{ rating: 0 }],
    [{ rating: 6 }],
    [{ rating: 4.5 }],
    [{}],
    [{ rating: 4, text: 'a'.repeat(1001) }],
    [{ rating: 4, hotelId: 'x' }],
  ])('answers 400 for %p', async (body) => {
    const before = await ratingOfHotel();

    const response = await review(ids.get('third') ?? '', body);

    expect(response.status).toBe(400);
    expect(await ratingOfHotel()).toEqual(before);
  });

  it('does not let another user edit or delete a review (404), and changes nothing', async () => {
    const [mine] = await reviews
      .find({ bookingId: new Types.ObjectId(ids.get('third')) })
      .lean()
      .exec();
    const id = mine._id.toString();

    for (const response of [
      await edit(id, { rating: 1 }, 'other'),
      await remove(id, 'other'),
      await edit(new Types.ObjectId().toString(), { rating: 1 }),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(REVIEW_NOT_FOUND_MESSAGE);
    }
    expect((await reviews.findById(id).lean().orFail().exec()).rating).toBe(
      mine.rating,
    );
  });

  it('answers 400 for an edit with nothing, a null or a bad value, and a bad id', async () => {
    const [mine] = await reviews
      .find({ bookingId: new Types.ObjectId(ids.get('third')) })
      .lean()
      .exec();
    const id = mine._id.toString();

    for (const body of [{}, { rating: null }, { text: null }, { rating: 7 }]) {
      expect((await edit(id, body)).status).toBe(400);
    }
    expect((await edit('not-an-id', { rating: 2 })).status).toBe(400);
    expect((await remove('not-an-id')).status).toBe(400);
  });

  it('needs a login (401) and a registered user (403)', async () => {
    const bookingId = ids.get('third') ?? '';
    const anyId = new Types.ObjectId().toString();

    expect((await review(bookingId, { rating: 4 }, 'guest')).status).toBe(401);
    expect((await edit(anyId, { rating: 4 }, 'guest')).status).toBe(401);
    expect((await remove(anyId, 'guest')).status).toBe(401);
    for (const who of ['admin', 'moderator']) {
      expect((await review(bookingId, { rating: 4 }, who)).status).toBe(403);
      expect((await edit(anyId, { rating: 4 }, who)).status).toBe(403);
      expect((await remove(anyId, who)).status).toBe(403);
    }
  });

  it('is documented in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, { responses: Record<string, unknown> }>
    >;

    expect(
      Object.keys(paths['/api/hotel-bookings/{id}/review'].post.responses),
    ).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );
    expect(Object.keys(paths['/api/reviews/{id}'].patch.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
    expect(Object.keys(paths['/api/reviews/{id}'].delete.responses)).toEqual(
      expect.arrayContaining(['204', '400', '401', '403', '404']),
    );
  });
});
