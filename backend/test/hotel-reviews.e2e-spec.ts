import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingCompletionService } from './../src/hotel-bookings/hotel-booking-completion.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { todayUtc } from './../src/hotels/room-dates';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

/** A date `days` after today (UTC); negative for the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

describe('Hotel ratings and reviews (e2e, HTL-23)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let hotelId: string;
  const cookies = new Map<string, string>();
  const userIds = new Map<string, string>();
  const ids: Record<string, string> = {};

  const as = (who: string | undefined, call: request.Test) =>
    who ? call.set('Cookie', cookies.get(who) ?? '') : call;

  const review = (who: string | undefined, bookingId: string, body: object) =>
    as(
      who,
      request(app.getHttpServer())
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send(body),
    );

  const edit = (who: string | undefined, reviewId: string, body: object) =>
    as(
      who,
      request(app.getHttpServer()).patch(`/api/reviews/${reviewId}`).send(body),
    );

  const remove = (who: string | undefined, reviewId: string) =>
    as(who, request(app.getHttpServer()).delete(`/api/reviews/${reviewId}`));

  const rating = async () => {
    const hotel = await hotels
      .findById(hotelId)
      .select('averageRating ratingCount')
      .lean()
      .exec();
    return { average: hotel?.averageRating, count: hotel?.ratingCount };
  };

  const createBooking = async (
    label: string,
    owner: string,
    fields: Partial<HotelBooking>,
  ) => {
    const booking = await bookings.create({
      userId: new Types.ObjectId(userIds.get(owner)),
      hotelId: new Types.ObjectId(hotelId),
      checkIn: day(-5),
      checkOut: day(-3),
      nights: 2,
      status: HotelBookingStatus.Completed,
      currency: 'USD',
      total: 20000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: 10000,
          adults: 2,
          childAges: [],
        },
        {
          roomId: new Types.ObjectId(),
          roomLabel: '102 (Double)',
          pricePerNight: 10000,
          adults: 1,
          childAges: [],
        },
      ],
      cancellationTiers: [],
      policyAcceptedAt: new Date(),
      ...fields,
    });
    const id = booking._id.toString();
    createdBookingIds.push(id);
    ids[label] = id;
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
      cityId: 'htl23-test-city',
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-23 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    hotelId = hotel._id.toString();

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['sara', Role.User],
      ['omar', Role.User],
      ['moderator', Role.HotelModerator],
    ];
    for (const [label, role] of accounts) {
      const email = `htl23-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-23 ${label}`,
        email,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(role === Role.HotelModerator && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: hotel._id,
          },
        }),
      });
      createdUserIds.push(user._id.toString());
      userIds.set(label, user._id.toString());

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const header = login.headers['set-cookie'] as unknown as string[];
      const accessCookie = header
        .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
        ?.split(';')[0];
      expect(accessCookie).toBeDefined();
      cookies.set(label, accessCookie!);
    }

    await createBooking('completed', 'sara', {});
    await createBooking('checkedOut', 'omar', {
      status: HotelBookingStatus.Confirmed,
      checkOut: day(-1),
    });
    await createBooking('upcoming', 'sara', {
      status: HotelBookingStatus.Confirmed,
      checkIn: day(5),
      checkOut: day(7),
    });
    await createBooking('leavingToday', 'sara', {
      status: HotelBookingStatus.Confirmed,
      checkIn: day(-2),
      checkOut: day(0),
    });
    await createBooking('cancelled', 'sara', {
      status: HotelBookingStatus.Cancelled,
    });
    await createBooking('expired', 'sara', {
      status: HotelBookingStatus.Expired,
    });
    await createBooking('toComplete', 'omar', {
      status: HotelBookingStatus.Confirmed,
      checkOut: day(-2),
    });
  });

  afterAll(async () => {
    for (const bookingId of createdBookingIds) {
      const own = await reviews
        .find({ bookingId: new Types.ObjectId(bookingId) })
        .select('_id')
        .lean()
        .exec();
      for (const { _id } of own) {
        await reviews.findByIdAndDelete(_id);
      }
      await bookings.findByIdAndDelete(bookingId);
    }
    await hotels.findByIdAndDelete(hotelId);
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('reviews a completed stay once, whatever its number of rooms, and rates the hotel', async () => {
    const response = await review('sara', ids.completed, {
      rating: 5,
      text: '  Quiet rooms and a great breakfast.  ',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      hotelId,
      bookingId: ids.completed,
      rating: 5,
      text: 'Quiet rooms and a great breakfast.',
      authorName: 'HTL-23 sara',
      createdAt: expect.stringMatching(/Z$/),
      updatedAt: expect.stringMatching(/Z$/),
    });
    ids.saraReview = response.body.id;
    expect(await rating()).toEqual({ average: 5, count: 1 });

    const again = await review('sara', ids.completed, { rating: 1 });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe(
      'This reservation already has a review. Edit it instead.',
    );
    expect(await rating()).toEqual({ average: 5, count: 1 });
  });

  it('accepts a confirmed stay whose check-out date has passed, and averages the ratings', async () => {
    const response = await review('omar', ids.checkedOut, { rating: 2 });

    expect(response.status).toBe(201);
    expect(response.body.text).toBeNull();
    ids.omarReview = response.body.id;
    expect(await rating()).toEqual({ average: 3.5, count: 2 });
  });

  it.each([
    ['an upcoming stay', 'upcoming'],
    ['a stay that ends today', 'leavingToday'],
    ['a cancelled reservation', 'cancelled'],
    ['an expired reservation', 'expired'],
  ])('answers 409 for %s', async (_, label) => {
    const response = await review('sara', ids[label], { rating: 4 });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Only a completed stay can be reviewed: the check-out date must have passed',
    );
  });

  it("answers 403 for someone else's reservation, 404 for a missing one and 400 for bad input", async () => {
    expect((await review('omar', ids.completed, { rating: 4 })).status).toBe(
      403,
    );
    expect(
      (await review('sara', new Types.ObjectId().toString(), { rating: 4 }))
        .status,
    ).toBe(404);
    expect((await review('sara', 'nope', { rating: 4 })).status).toBe(400);
    expect((await review('sara', ids.upcoming, { rating: 6 })).status).toBe(
      400,
    );
    expect(
      (
        await review('sara', ids.upcoming, {
          rating: 4,
          text: 'x'.repeat(1001),
        })
      ).status,
    ).toBe(400);
  });

  it('lets the author edit the rating and the text, and recalculates', async () => {
    const response = await edit('omar', ids.omarReview, {
      rating: 4,
      text: 'Better than I said.',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ rating: 4, text: 'Better than I said.' }),
    );
    expect(await rating()).toEqual({ average: 4.5, count: 2 });

    const cleared = await edit('omar', ids.omarReview, { text: '' });
    expect(cleared.body.text).toBeNull();
    expect(cleared.body.rating).toBe(4);
  });

  it("refuses to edit someone else's review, an empty edit and a missing review", async () => {
    expect((await edit('sara', ids.omarReview, { rating: 1 })).status).toBe(
      403,
    );
    const empty = await edit('omar', ids.omarReview, {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('Send rating, text or both');
    expect(
      (await edit('omar', new Types.ObjectId().toString(), { rating: 1 }))
        .status,
    ).toBe(404);
    expect(await rating()).toEqual({ average: 4.5, count: 2 });
  });

  it('lets the author delete the review, recalculates, and allows a new one', async () => {
    expect((await remove('sara', ids.omarReview)).status).toBe(403);

    const response = await remove('omar', ids.omarReview);
    expect(response.status).toBe(204);
    expect(await rating()).toEqual({ average: 5, count: 1 });
    expect((await remove('omar', ids.omarReview)).status).toBe(404);

    const again = await review('omar', ids.checkedOut, { rating: 3 });
    expect(again.status).toBe(201);
    expect(await rating()).toEqual({ average: 4, count: 2 });
  });

  it('makes the hotel unrated again when its last review is deleted', async () => {
    const extra = await review('omar', ids.toComplete, { rating: 1 });
    expect(extra.status).toBe(201);
    expect(await rating()).toEqual({ average: 3, count: 3 });

    const all = await reviews
      .find({ hotelId: new Types.ObjectId(hotelId) })
      .select('_id userId')
      .lean()
      .exec();
    for (const { _id, userId } of all) {
      const owner = [...userIds].find(([, id]) => id === userId.toString());
      expect((await remove(owner?.[0], _id.toString())).status).toBe(204);
    }
    expect(await rating()).toEqual({ average: 0, count: 0 });
  });

  it('completes confirmed stays after their check-out date (HTL-23, GEN-11)', async () => {
    await app.get(HotelBookingCompletionService).completeStays(todayUtc());

    const stored = async (label: string) =>
      (await bookings.findById(ids[label]).lean().exec())?.status;
    expect(await stored('toComplete')).toBe(HotelBookingStatus.Completed);
    expect(await stored('checkedOut')).toBe(HotelBookingStatus.Completed);
    expect(await stored('leavingToday')).toBe(HotelBookingStatus.Confirmed);
    expect(await stored('upcoming')).toBe(HotelBookingStatus.Confirmed);
    expect(await stored('cancelled')).toBe(HotelBookingStatus.Cancelled);
  });

  it('is for registered users only', async () => {
    expect((await review(undefined, ids.completed, { rating: 4 })).status).toBe(
      401,
    );
    expect(
      (await review('moderator', ids.completed, { rating: 4 })).status,
    ).toBe(403);
    expect(
      (await edit('moderator', new Types.ObjectId().toString(), { rating: 4 }))
        .status,
    ).toBe(403);
    expect(
      (await remove(undefined, new Types.ObjectId().toString())).status,
    ).toBe(401);
  });
});
