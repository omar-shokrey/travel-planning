import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { ReviewModeration } from './../src/hotel-bookings/enums/review-moderation.enum';
import {
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_REPLY_EXISTS_MESSAGE,
} from './../src/hotel-bookings/hotel-bookings.constants';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `htl26-${randomUUID().slice(0, 8)}`;

/** The rating stored on the suite's hotel; a reply must never change it. */
const HOTEL_RATING = { ratingCount: 3, averageRating: 4.5 };

interface ReplyBody {
  text: string;
  repliedAt: string;
}

interface ReviewBody {
  id: string;
  hotelId: string;
  bookingId: string;
  rating: number;
  text: string | null;
  reply: ReplyBody | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * HTL-26 end to end, on the "-test" database. The suite creates its own two
 * hotels, its users (with the moderators' assignments) and its reviews,
 * inserted with the model of hotel-bookings, and deletes every record by id.
 */
describe('Replies to hotel reviews (e2e, HTL-26)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let reviews: Model<Review>;
  const userIds: string[] = [];
  const hotelIds: string[] = [];
  const reviewIds: string[] = [];
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const http = () => request(app.getHttpServer());
  const id = (label: string): string => ids.get(label) ?? '';

  const as = <T extends { set: (k: string, v: string) => T }>(
    call: T,
    who?: string,
  ): T => {
    const cookie = who ? cookies.get(who) : undefined;
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const reply = (reviewId: string, body: unknown, who = 'moderator') =>
    as(http().post(`/api/reviews/${reviewId}/reply`), who).send(body as object);

  const stored = (reviewId: string) => reviews.findById(reviewId).lean().exec();

  const ratingOfHotel = async () => {
    const hotel = await hotels.findById(id('hotel')).lean().orFail().exec();
    return {
      ratingCount: hotel.ratingCount,
      averageRating: hotel.averageRating,
    };
  };

  const createHotel = async (label: string) => {
    const hotel = await hotels.create({
      name: `HTL-26 ${label} ${RUN}`,
      addressLine: '26 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-26 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      ...HOTEL_RATING,
    });
    hotelIds.push(hotel._id.toString());
    ids.set(label, hotel._id.toString());
  };

  const createActor = async (
    label: string,
    role: Role,
    assignment?: { providerType: ProviderType; providerId: string },
  ) => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: `${RUN}-${label.toLowerCase()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(assignment && {
        assignment: {
          providerType: assignment.providerType,
          providerId: new Types.ObjectId(assignment.providerId),
        },
      }),
    });
    const userId = created._id.toString();
    userIds.push(userId);
    ids.set(label, userId);
    cookies.set(label, await sessionCookieFor(app, userId));
  };

  /** A review of the suite's hotel by the author, stored with the model. */
  const addReview = async (
    label: string,
    moderation: ReviewModeration = ReviewModeration.Visible,
  ) => {
    const created = await reviews.create({
      hotelId: new Types.ObjectId(id('hotel')),
      userId: new Types.ObjectId(id('author')),
      bookingId: new Types.ObjectId(),
      rating: 4,
      text: `Review ${label}`,
      moderation,
    });
    reviewIds.push(created._id.toString());
    ids.set(label, created._id.toString());
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

    await createHotel('hotel');
    await createHotel('otherHotel');

    await createActor('author', Role.User);
    await createActor('otherUser', Role.User);
    await createActor('admin', Role.Admin);
    await createActor('moderator', Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: id('hotel'),
    });
    await createActor('otherModerator', Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: id('otherHotel'),
    });
    await createActor('airlineModerator', Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: new Types.ObjectId().toString(),
    });

    for (const label of [
      'main',
      'second',
      'race',
      'denied',
      'invalid',
      'deleted',
    ]) {
      await addReview(label);
    }
    await addReview('hidden', ReviewModeration.Hidden);
  });

  afterAll(async () => {
    if (!app) return;
    for (const reviewId of reviewIds) {
      await reviews.findByIdAndDelete(reviewId).exec();
    }
    for (const hotelId of hotelIds) {
      await hotels.findByIdAndDelete(hotelId).exec();
    }
    for (const userId of userIds) {
      await deleteSessionsOf(app, userId);
      await users.findByIdAndDelete(userId).exec();
    }
    await app.close();
  });

  it("lets the hotel's moderator reply: 201 with the reply, stored with the moderator id, the rating and updatedAt unchanged", async () => {
    const before = await stored(id('main'));

    const response = await reply(id('main'), {
      text: '  Thank you for your stay.  ',
    });

    expect(response.status).toBe(201);
    const body = response.body as ReviewBody;
    expect(body).toEqual({
      id: id('main'),
      hotelId: id('hotel'),
      bookingId: before?.bookingId.toString(),
      rating: 4,
      text: 'Review main',
      reply: {
        text: 'Thank you for your stay.',
        repliedAt: expect.stringMatching(/Z$/),
      },
      createdAt: expect.stringMatching(/Z$/),
      updatedAt: before?.updatedAt.toISOString(),
    });
    expect(JSON.stringify(body)).not.toContain(id('moderator'));

    const after = await stored(id('main'));
    expect(after?.reply?.text).toBe('Thank you for your stay.');
    expect(after?.reply?.moderatorId.toString()).toBe(id('moderator'));
    expect(after?.reply?.repliedAt.toISOString()).toBe(body.reply?.repliedAt);
    expect(after?.updatedAt.toISOString()).toBe(
      before?.updatedAt.toISOString(),
    );
    expect(await ratingOfHotel()).toEqual(HOTEL_RATING);
  });

  it('answers 409 to a second reply and keeps the first one', async () => {
    expect((await reply(id('second'), { text: 'First reply' })).status).toBe(
      201,
    );
    const first = await stored(id('second'));

    const second = await reply(id('second'), { text: 'Second reply' });

    expect(second.status).toBe(409);
    expect(second.body.message).toBe(REVIEW_REPLY_EXISTS_MESSAGE);
    expect((await stored(id('second')))?.reply).toEqual(first?.reply);
  });

  it('lets exactly one of two simultaneous replies win: one 201 and one 409', async () => {
    const answers = await Promise.all([
      reply(id('race'), { text: 'Reply A' }),
      reply(id('race'), { text: 'Reply B' }),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    const [winner] = answers
      .filter((answer) => answer.status === 201)
      .map((answer) => answer.body as ReviewBody);
    expect((await stored(id('race')))?.reply?.text).toBe(winner.reply?.text);
    expect(await ratingOfHotel()).toEqual(HOTEL_RATING);
  });

  it('refuses the moderator of another hotel as HTL-22 does (403) and stores nothing', async () => {
    const response = await reply(
      id('denied'),
      { text: 'Not my hotel' },
      'otherModerator',
    );

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not manage this hotel');
    expect((await stored(id('denied')))?.reply).toBeUndefined();
  });

  it.each(['airlineModerator', 'admin', 'author', 'otherUser'])(
    'answers 403 to the %s and stores nothing',
    async (who) => {
      const response = await reply(id('denied'), { text: 'Hello' }, who);

      expect(response.status).toBe(403);
      expect((await stored(id('denied')))?.reply).toBeUndefined();
    },
  );

  it('answers 401 to a guest and stores nothing', async () => {
    const response = await reply(id('denied'), { text: 'Hello' }, 'guest');

    expect(response.status).toBe(401);
    expect((await stored(id('denied')))?.reply).toBeUndefined();
  });

  it('answers 404 "Review not found" for a missing review', async () => {
    const response = await reply(new Types.ObjectId().toString(), {
      text: 'Hello',
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(REVIEW_NOT_FOUND_MESSAGE);
  });

  it('answers the same 404 for a hidden review and stores nothing', async () => {
    const response = await reply(id('hidden'), { text: 'Hello' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(REVIEW_NOT_FOUND_MESSAGE);
    expect((await stored(id('hidden')))?.reply).toBeUndefined();
  });

  it('answers 400 for an id that is not a valid id', async () => {
    expect((await reply('not-an-id', { text: 'Hello' })).status).toBe(400);
  });

  it.each([
    ['no text', {}, 'text', 'text is required'],
    ['a null text', { text: null }, 'text', 'text is required'],
    ['an empty text', { text: '' }, 'text', 'text must not be empty'],
    [
      'a text of spaces only',
      { text: '   ' },
      'text',
      'text must not be empty',
    ],
    [
      'a text of 1001 characters',
      { text: 'a'.repeat(1001) },
      'text',
      'text must have at most 1000 characters',
    ],
    ['a text that is a number', { text: 7 }, 'text', 'text must be a text'],
    [
      'a rating',
      { text: 'Hi', rating: 5 },
      'rating',
      'property rating should not exist',
    ],
    [
      'a moderatorId',
      { text: 'Hi', moderatorId: new Types.ObjectId().toString() },
      'moderatorId',
      'property moderatorId should not exist',
    ],
    [
      'a repliedAt',
      { text: 'Hi', repliedAt: '2027-01-01T00:00:00.000Z' },
      'repliedAt',
      'property repliedAt should not exist',
    ],
  ])(
    'answers 400 for %s, naming the field and the message, and stores nothing',
    async (_label, body, field, message) => {
      const response = await reply(id('invalid'), body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { field, messages: expect.arrayContaining([message]) },
        ]),
      );
      expect((await stored(id('invalid')))?.reply).toBeUndefined();
    },
  );

  it("shows the reply in the hotel's public list of reviews (HTL-24), without the moderator id", async () => {
    const response = await http()
      .get(`/api/hotels/${id('hotel')}/reviews`)
      .query({ limit: 50 })
      .expect(200);
    const items = (
      response.body as { items: { id: string; reply?: ReplyBody }[] }
    ).items;

    const main = items.find((item) => item.id === id('main'));
    expect(main?.reply).toEqual({
      text: 'Thank you for your stay.',
      repliedAt: expect.stringMatching(/Z$/),
    });
    expect(items.find((item) => item.id === id('invalid'))).not.toHaveProperty(
      'reply',
    );
    expect(JSON.stringify(items)).not.toContain(id('moderator'));
  });

  it('keeps the reply when the author edits the review', async () => {
    const replied = await stored(id('main'));

    const response = await as(
      http().patch(`/api/reviews/${id('main')}`),
      'author',
    ).send({ rating: 2 });

    expect(response.status).toBe(200);
    expect((response.body as ReviewBody).rating).toBe(2);
    expect((response.body as ReviewBody).reply).toEqual({
      text: 'Thank you for your stay.',
      repliedAt: replied?.reply?.repliedAt.toISOString(),
    });
    expect((await stored(id('main')))?.reply).toEqual(replied?.reply);
  });

  it('removes the reply with the review when the author deletes it', async () => {
    expect((await reply(id('deleted'), { text: 'Thanks' })).status).toBe(201);

    const response = await as(
      http().delete(`/api/reviews/${id('deleted')}`),
      'author',
    );

    expect(response.status).toBe(204);
    expect(await stored(id('deleted'))).toBeNull();
  });

  it('is documented in Swagger with the login cookie, its answers and a reply schema of its own', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/reviews/{id}/reply'].post as {
      summary: string;
      tags: string[];
      security?: unknown[];
      responses: Record<string, unknown>;
    };
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    expect(operation.summary).toContain('HTL-26');
    expect(operation.tags).toEqual(['reviews']);
    expect(operation.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );
    expect(Object.keys(schemas.CreateReviewReplyDto.properties)).toEqual([
      'text',
    ]);
    expect(
      Object.keys(schemas.ReviewReplyResponseDto.properties).sort(),
    ).toEqual(['repliedAt', 'text']);
    expect(schemas.ReviewResponseDto.properties).toHaveProperty('reply');
  });
});
