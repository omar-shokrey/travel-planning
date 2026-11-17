import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Role } from './../src/common/enums/role.enum';
import { ReviewModeration } from './../src/hotel-bookings/enums/review-moderation.enum';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';

const RUN = randomUUID().slice(0, 8);

describe("A hotel's reviews, for everyone (e2e, HTL-24)", () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let reviews: Model<Review>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdReviewIds: string[] = [];

  let hotelId: string;
  let closedHotelId: string;
  let otherHotelId: string;
  const ids: Record<string, string> = {};

  const list = (hotel: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(`/api/hotels/${hotel}/reviews`)
      .query(query);

  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((item) => item.id);

  const createReview = async (
    label: string,
    hotel: string,
    author: string,
    minutesAgo: number,
    fields: Partial<Review> = {},
  ) => {
    const at = new Date(Date.now() - minutesAgo * 60 * 1000);
    const created = await reviews.create({
      hotelId: new Types.ObjectId(hotel),
      userId: new Types.ObjectId(author),
      bookingId: new Types.ObjectId(),
      rating: 4,
      text: `Review ${label}`,
      createdAt: at,
      updatedAt: at,
      ...fields,
    });
    const id = created._id.toString();
    createdReviewIds.push(id);
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
    reviews = app.get<Model<Review>>(getModelToken(Review.name));

    const hotel = (label: string, active = true) => ({
      name: `HTL-24 ${label} hotel ${RUN}`,
      addressLine: '24 Nile Street',
      cityId: 'htl24-test-city',
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-24 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      active,
      averageRating: 4.5,
      ratingCount: 4,
    });
    const [main, closed, other] = await hotels.insertMany([
      hotel('main'),
      hotel('closed', false),
      hotel('other'),
    ]);
    hotelId = main._id.toString();
    closedHotelId = closed._id.toString();
    otherHotelId = other._id.toString();
    createdHotelIds.push(hotelId, closedHotelId, otherHotelId);

    const author = await users.create({
      name: `HTL-24 author ${RUN}`,
      email: `htl24-author-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    createdUserIds.push(author._id.toString());
    const authorId = author._id.toString();
    const goneAuthor = new Types.ObjectId().toString();

    await createReview('oldest', hotelId, authorId, 30, { rating: 5 });
    await createReview('middle', hotelId, goneAuthor, 20, {
      rating: 3,
      text: undefined,
    });
    await createReview('newest', hotelId, authorId, 10, { rating: 5 });
    await createReview('hidden', hotelId, authorId, 5, {
      moderation: ReviewModeration.Hidden,
    });
    await createReview('elsewhere', otherHotelId, authorId, 1);
  });

  afterAll(async () => {
    for (const id of createdReviewIds) {
      await reviews.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('lists the visible reviews of the hotel to a guest, newest first', async () => {
    const response = await list(hotelId);

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([ids.newest, ids.middle, ids.oldest]);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 3,
      totalPages: 1,
    });
  });

  it('shows the rating, text, author and date of each review', async () => {
    const response = await list(hotelId);

    expect(response.body.items[0]).toEqual({
      id: ids.newest,
      hotelId,
      bookingId: expect.any(String),
      rating: 5,
      text: 'Review newest',
      authorName: `HTL-24 author ${RUN}`,
      createdAt: expect.stringMatching(/Z$/),
      updatedAt: expect.stringMatching(/Z$/),
    });
    expect(response.body.items[1]).toEqual(
      expect.objectContaining({ text: null, authorName: null }),
    );
    expect(response.body.items[0]).not.toHaveProperty('userId');
    expect(response.body.items[0]).not.toHaveProperty('moderation');
  });

  it('pages through the reviews', async () => {
    const response = await list(hotelId, { page: '2', limit: '2' });

    expect(idsOf(response.body)).toEqual([ids.oldest]);
    expect(response.body.meta.totalPages).toBe(2);
  });

  it('shows the average and the number of ratings on the hotel page', async () => {
    const response = await request(app.getHttpServer()).get(
      `/api/hotels/${hotelId}`,
    );

    expect(response.body).toEqual(
      expect.objectContaining({ averageRating: 4.5, ratingCount: 4 }),
    );
  });

  it('never mixes in the reviews of another hotel', async () => {
    expect(idsOf((await list(otherHotelId)).body)).toEqual([ids.elsewhere]);
  });

  it('answers 404 for a deactivated or missing hotel, and 400 for a bad id', async () => {
    expect((await list(closedHotelId)).status).toBe(404);
    expect((await list(new Types.ObjectId().toString())).status).toBe(404);
    expect((await list('nile')).status).toBe(400);
  });
});
