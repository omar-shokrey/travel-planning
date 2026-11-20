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
import { ReviewModeration } from './../src/hotel-bookings/enums/review-moderation.enum';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);

interface ReviewBody {
  id: string;
  rating: number;
  text?: string;
  authorName: string;
  createdAt: string;
}
interface PageBody {
  items: ReviewBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * HTL-24 on the "-test" database. The reviews are inserted with the model of
 * the hotel-bookings module, with a set `createdAt`, so the order is known.
 * Everything this file creates is deleted again, one record at a time.
 */
describe('Reviews of a hotel (e2e, HTL-24)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let reviews: Model<Review>;

  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdReviewIds: Types.ObjectId[] = [];
  let viewerCookie = '';

  const ids: Record<string, string> = {};
  const authors: Record<string, Types.ObjectId> = {};

  const list = (hotelId: string, query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get(`/api/hotels/${hotelId}/reviews`)
      .query(query);
  const ratings = (body: PageBody) => body.items.map((item) => item.rating);

  const createUser = async (
    label: string,
    status: UserStatus = UserStatus.Active,
  ): Promise<Types.ObjectId> => {
    const user = await users.create({
      name: `${label} ${RUN}`,
      email: `htl24-${label.toLowerCase()}-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
      status,
    });
    createdUserIds.push(user._id.toString());
    authors[label] = user._id;
    return user._id;
  };

  const createHotel = async (label: string, active = true): Promise<string> => {
    const hotel = await hotels.create({
      name: `HTL-24 ${label} ${RUN}`,
      addressLine: '1 Test Street',
      cityId: `htl24-city-${RUN}`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-24 e2e test.',
      photos: [],
      starClass: 3,
      amenities: [],
      active,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    ids[label] = id;
    return id;
  };

  /** One review, written at `createdAt`, through the native collection. */
  const addReview = async (
    hotelId: string,
    userId: Types.ObjectId,
    rating: number,
    createdAt: string,
    fields: { text?: string; moderation?: ReviewModeration } = {},
  ): Promise<string> => {
    const _id = new Types.ObjectId();
    createdReviewIds.push(_id);
    await reviews.collection.insertOne({
      _id,
      hotelId: new Types.ObjectId(hotelId),
      userId,
      bookingId: new Types.ObjectId(),
      rating,
      moderation: fields.moderation ?? ReviewModeration.Visible,
      ...(fields.text !== undefined ? { text: fields.text } : {}),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });
    return _id.toString();
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
    await reviews.init();

    const mona = await createUser('Mona');
    const sami = await createUser('Sami', UserStatus.Suspended);
    const gone = await createUser('Gone', UserStatus.Deactivated);
    // An author whose account no longer exists at all.
    authors.Missing = new Types.ObjectId();
    const viewer = await createUser('Viewer');
    viewerCookie = await sessionCookieFor(app, viewer.toString());

    const garden = await createHotel('Garden');
    // Newest first: 5 (Nov 10), 3 (Nov 8, hidden), 4 (Nov 6), 2 (Nov 4),
    // 1 (Nov 2). Two reviews share Nov 1, so the id breaks the tie.
    ids.newest = await addReview(garden, mona, 5, '2026-11-10T09:00:00.000Z', {
      text: 'Lovely garden.',
    });
    await addReview(garden, mona, 3, '2026-11-08T09:00:00.000Z', {
      text: 'Hidden by a moderator.',
      moderation: ReviewModeration.Hidden,
    });
    await addReview(garden, sami, 4, '2026-11-06T09:00:00.000Z', {
      text: 'Good breakfast.',
    });
    await addReview(garden, gone, 2, '2026-11-04T09:00:00.000Z', {
      text: 'Noisy street.',
    });
    await addReview(garden, authors.Missing, 1, '2026-11-02T09:00:00.000Z');
    ids.tieFirst = await addReview(garden, mona, 3, '2026-11-01T09:00:00.000Z');
    ids.tieSecond = await addReview(
      garden,
      mona,
      4,
      '2026-11-01T09:00:00.000Z',
    );

    // Another hotel's review never shows on Garden's list.
    const other = await createHotel('Other');
    await addReview(other, mona, 5, '2026-11-09T09:00:00.000Z');

    await createHotel('Empty');

    // A deactivated hotel (ACC-15) answers 404, even with reviews.
    const closed = await createHotel('Closed', false);
    await addReview(closed, mona, 5, '2026-11-09T09:00:00.000Z');
  });

  afterAll(async () => {
    for (const id of createdReviewIds) {
      await reviews.deleteOne({ _id: id });
    }
    for (const id of createdHotelIds) {
      await hotels.deleteOne({ _id: id });
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.deleteOne({ _id: id });
    }
    await app.close();
  });

  it('lists, for a guest, the visible reviews of the hotel newest first, with the id breaking a tie', async () => {
    const response = await list(ids.Garden).expect(200);
    const body = response.body as PageBody;

    // The two reviews of Nov 1 share createdAt: the larger id comes first.
    expect(ratings(body)).toEqual([5, 4, 2, 1, 4, 3]);
    expect(body.items[4].id).toBe(ids.tieSecond);
    expect(body.items[5].id).toBe(ids.tieFirst);
    expect(body.meta).toEqual({ page: 1, limit: 10, total: 6, totalPages: 1 });
  });

  it('shows each review with its id, rating, text, author name and UTC time, and nothing else', async () => {
    const response = await list(ids.Garden).expect(200);
    const [first] = (response.body as PageBody).items;

    expect(first).toEqual({
      id: ids.newest,
      rating: 5,
      text: 'Lovely garden.',
      authorName: `Mona ${RUN}`,
      createdAt: '2026-11-10T09:00:00.000Z',
    });
    const leaked = JSON.stringify((response.body as PageBody).items);
    expect(leaked).not.toContain(authors.Mona.toString());
    for (const field of [
      'userId',
      'bookingId',
      'hotelId',
      'moderation',
      'updatedAt',
    ]) {
      expect(leaked).not.toContain(`"${field}"`);
    }
  });

  it('leaves the text out of a review that has none', async () => {
    const response = await list(ids.Garden).expect(200);
    const withoutText = (response.body as PageBody).items[3];

    expect(withoutText.rating).toBe(1);
    expect(withoutText).not.toHaveProperty('text');
  });

  it('leaves a hidden review out of the items and the total', async () => {
    const response = await list(ids.Garden).expect(200);
    const body = response.body as PageBody;

    expect(body.items.map((item) => item.text)).not.toContain(
      'Hidden by a moderator.',
    );
    expect(body.meta.total).toBe(6);
  });

  it('shows "Deleted user" for a deactivated or missing author, and the name of a suspended one', async () => {
    const response = await list(ids.Garden).expect(200);
    const byRating = Object.fromEntries(
      (response.body as PageBody).items
        .slice(0, 4)
        .map((item) => [item.rating, item.authorName]),
    );

    expect(byRating).toEqual({
      5: `Mona ${RUN}`,
      4: `Sami ${RUN}`,
      2: 'Deleted user',
      1: 'Deleted user',
    });
  });

  it('gives a logged-in user the same page as a guest', async () => {
    const asUser = await list(ids.Garden)
      .set('Cookie', viewerCookie)
      .expect(200);
    const asGuest = await list(ids.Garden).expect(200);

    expect(asUser.body).toEqual(asGuest.body);
  });

  it('pages the reviews and keeps the total on every page', async () => {
    const first = await list(ids.Garden, { page: 1, limit: 4 }).expect(200);
    const second = await list(ids.Garden, { page: 2, limit: 4 }).expect(200);
    const meta = { limit: 4, total: 6, totalPages: 2 };

    expect(ratings(first.body as PageBody)).toEqual([5, 4, 2, 1]);
    expect(ratings(second.body as PageBody)).toEqual([4, 3]);
    expect((first.body as PageBody).meta).toEqual({ page: 1, ...meta });
    expect((second.body as PageBody).meta).toEqual({ page: 2, ...meta });
  });

  it("never shows another hotel's reviews", async () => {
    const other = await list(ids.Other).expect(200);

    expect(ratings(other.body as PageBody)).toEqual([5]);
    expect((other.body as PageBody).meta.total).toBe(1);
  });

  it('answers an empty page for a hotel with no review', async () => {
    const response = await list(ids.Empty).expect(200);

    expect(response.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('answers 404 "Hotel not found" for a deactivated hotel, as the hotel page does', async () => {
    const reviewsPage = await list(ids.Closed).expect(404);
    const hotelPage = await request(app.getHttpServer())
      .get(`/api/hotels/${ids.Closed}`)
      .expect(404);

    expect(reviewsPage.body.message).toBe('Hotel not found');
    expect(reviewsPage.body.message).toBe(hotelPage.body.message);
  });

  it('answers 404 "Hotel not found" for a hotel that does not exist', async () => {
    const response = await list(new Types.ObjectId().toString()).expect(404);

    expect(response.body.message).toBe('Hotel not found');
  });

  it('answers 400 for a hotel id that is not an id', async () => {
    const response = await list('not-an-id').expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'id must be a valid id (24 hexadecimal characters)',
    });
  });

  it.each([
    ['page 0', { page: 0 }, 'page'],
    ['a limit above the maximum', { limit: 51 }, 'limit'],
    ['an unknown parameter', { sortBy: 'rating' }, 'sortBy'],
  ])('answers 400 for %s, naming the field', async (_label, query, field) => {
    const response = await list(ids.Garden, query).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
    });
    expect(
      (response.body.errors as { field: string }[]).map((error) => error.field),
    ).toEqual([field]);
  });

  it('is not read as the hotel page GET /api/hotels/:id', async () => {
    const page = await request(app.getHttpServer())
      .get(`/api/hotels/${ids.Garden}`)
      .expect(200);
    const response = await list(ids.Garden).expect(200);

    expect(page.body).toHaveProperty('name', `HTL-24 Garden ${RUN}`);
    expect(response.body).toHaveProperty('items');
  });

  it('documents the route in Swagger as a public, paginated list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const operation = response.body.paths['/api/hotels/{id}/reviews'].get as {
      tags: string[];
      summary: string;
      parameters: { name: string; in: string; required: boolean }[];
      responses: Record<string, { content?: unknown }>;
    };

    expect(operation.tags).toEqual(['hotels']);
    expect(operation.summary).toBe('Reviews of a hotel (HTL-24)');
    expect(
      operation.parameters.map(({ name, in: where }) => `${where}:${name}`),
    ).toEqual(expect.arrayContaining(['path:id', 'query:page', 'query:limit']));
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '404']),
    );
    expect(JSON.stringify(operation.responses['200'].content)).toContain(
      '#/components/schemas/HotelReviewResponseDto',
    );
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown>; required?: string[] }
    >;
    expect(schemas).toHaveProperty('HotelReviewResponseDto');
    expect(
      Object.keys(schemas.HotelReviewResponseDto.properties).sort(),
    ).toEqual(['authorName', 'createdAt', 'id', 'rating', 'text']);
    expect(schemas.HotelReviewResponseDto.required).not.toContain('text');
    // The review schema of HTL-23 keeps its own name.
    expect(schemas).toHaveProperty('ReviewResponseDto');
  });
});
