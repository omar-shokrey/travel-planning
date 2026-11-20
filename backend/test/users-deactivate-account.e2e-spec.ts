import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE,
  ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { DELETED_USER_NAME } from './../src/blog/blog.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { Comment } from './../src/blog/models/comment.schema';
import { Like } from './../src/blog/models/like.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './../src/common/constants/cookies';
import { PLATFORM_CURRENCY } from './../src/common/constants/currency';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from './../src/flight-bookings/enums/passenger-type.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { Report } from './../src/reports/models/report.schema';
import { User } from './../src/users/models/user.schema';
import { deleteAuditLogsOf } from './support/delete-audit-logs';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The value of one cookie of a response, ready for a `Cookie` header. */
function cookieOf(
  response: { headers: Record<string, unknown> },
  name: string,
): string {
  const line = setCookieLines(response).find((candidate) =>
    candidate.startsWith(`${name}=`),
  );
  return line?.split(';')[0] ?? '';
}

function setCookieLines(response: {
  headers: Record<string, unknown>;
}): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
}

/** A `YYYY-MM-DD` date some days from today, in UTC. */
const dayFromToday = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

interface Session {
  access: string;
  refresh: string;
}

interface SummaryRow {
  id: string;
}

describe('Deactivate my own account (e2e, ACC-12)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let comments: Model<Comment>;
  let likes: Model<Like>;
  let reports: Model<Report>;
  let itineraries: Model<Itinerary>;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;

  const RUN = randomUUID().slice(0, 8);
  /** A word in this file's titles and tags only, so other tests' data never shows. */
  const TOKEN = `zacc12${RUN}`;
  const TAG = `acc12-${RUN}`;

  const accounts = new Map<string, { id: string; email: string }>();
  const createdUserIds: string[] = [];
  const createdPostIds: Types.ObjectId[] = [];
  const createdCommentIds: Types.ObjectId[] = [];
  const createdItineraryIds: Types.ObjectId[] = [];
  const createdFlightBookingIds: Types.ObjectId[] = [];
  const createdHotelBookingIds: Types.ObjectId[] = [];

  const idOf = (label: string) => accounts.get(label)?.id ?? '';
  const server = () => request(app.getHttpServer());

  // Records of A (the account that is deactivated) and B (another user).
  const postA = new Types.ObjectId();
  const draftA = new Types.ObjectId();
  const postB = new Types.ObjectId();
  const commentAonB = new Types.ObjectId();
  const publicTripA = new Types.ObjectId();
  const privateTripA = new Types.ObjectId();
  const publicTripB = new Types.ObjectId();

  /** Sessions of A: the one that deactivates and a second browser. */
  let sessionA: Session;
  let otherSessionA: Session;
  let sessionB = '';
  let adminCookie = '';
  /** `updatedAt` of A's and B's posts as stored before the deactivation. */
  const updatedAtBefore = new Map<string, number>();

  const login = (label: string) =>
    server()
      .post('/api/auth/login')
      .send({ email: accounts.get(label)?.email, password: PASSWORD });

  const startSession = async (label: string): Promise<Session> => {
    const response = await login(label);
    expect(response.status).toBe(200);
    return {
      access: cookieOf(response, ACCESS_TOKEN_COOKIE),
      refresh: cookieOf(response, REFRESH_TOKEN_COOKIE),
    };
  };

  const deactivate = (cookie: string | null, body: object) => {
    const call = server().delete('/api/users/me');
    return (cookie ? call.set('Cookie', cookie) : call).send(body);
  };

  const myAccount = (cookie: string) =>
    server().get('/api/users/me').set('Cookie', cookie);

  const openPost = (id: Types.ObjectId) =>
    server().get(`/api/posts/${id.toString()}`);

  /** A booking of one adult on one flight, as stored. Deleted in afterAll. */
  const flightBooking = (
    label: string,
    status: FlightBookingStatus,
    holdExpiresAt?: Date,
  ) => {
    const id = new Types.ObjectId();
    createdFlightBookingIds.push(id);
    return {
      _id: id,
      userId: new Types.ObjectId(idOf(label)),
      status,
      ...(status !== FlightBookingStatus.PendingPayment &&
        status !== FlightBookingStatus.Expired && {
          reference: `FB-${randomUUID()
            .replaceAll('-', '')
            .slice(0, 6)
            .toUpperCase()
            .replace(/[01ILO]/g, 'Z')}`,
        }),
      ...(holdExpiresAt && { holdExpiresAt }),
      currency: PLATFORM_CURRENCY,
      fareTotal: 10000,
      baggageTotal: 0,
      total: 10000,
      segments: [
        {
          flightId: new Types.ObjectId(),
          airlineId: new Types.ObjectId(),
          cabin: CabinClass.Economy,
          fare: 10000,
          seatsReserved: 1,
        },
      ],
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      passengers: [
        {
          fullName: `ACC-12 ${label}`,
          dateOfBirth: '1990-05-14',
          passportNumber: 'ACC12PASS1',
          type: PassengerType.Adult,
        },
      ],
    };
  };

  /** A reservation of one room for one adult, in the future, as stored. */
  const hotelBooking = (
    label: string,
    status: HotelBookingStatus,
    holdExpiresAt?: Date,
  ) => {
    const id = new Types.ObjectId();
    createdHotelBookingIds.push(id);
    return {
      _id: id,
      userId: new Types.ObjectId(idOf(label)),
      hotelId: new Types.ObjectId(),
      checkIn: dayFromToday(30),
      checkOut: dayFromToday(32),
      nights: 2,
      status,
      ...(holdExpiresAt && { holdExpiresAt }),
      currency: PLATFORM_CURRENCY,
      total: 20000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: 10000,
          adults: 1,
          childAges: [],
        },
      ],
    };
  };

  /** Inserts one booking for one case, runs it, and deletes the booking by id. */
  const withFlightBooking = async (
    booking: ReturnType<typeof flightBooking>,
    run: () => Promise<void>,
  ) => {
    await flightBookings.insertMany([booking]);
    try {
      await run();
    } finally {
      await flightBookings.findByIdAndDelete(booking._id);
    }
  };

  const withHotelBooking = async (
    booking: ReturnType<typeof hotelBooking>,
    run: () => Promise<void>,
  ) => {
    await hotelBookings.insertMany([booking]);
    try {
      await run();
    } finally {
      await hotelBookings.findByIdAndDelete(booking._id);
    }
  };

  /** After a refusal: A is still active, A's post is public, the session works. */
  const expectNothingChanged = async () => {
    expect((await users.findById(idOf('A')).lean())?.status).toBe(
      UserStatus.Active,
    );
    expect((await openPost(postA)).status).toBe(200);
    expect((await myAccount(sessionA.access)).status).toBe(200);
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
    posts = app.get<Model<BlogPost>>(getModelToken(BlogPost.name));
    comments = app.get<Model<Comment>>(getModelToken(Comment.name));
    likes = app.get<Model<Like>>(getModelToken(Like.name));
    reports = app.get<Model<Report>>(getModelToken(Report.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    flightBookings = app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    hotelBookings = app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    const passwordHash = await hash(PASSWORD, 4);
    const seeds: [string, Role, object][] = [
      ['A', Role.User, {}],
      ['B', Role.User, {}],
      ['C', Role.User, {}],
      ['temporary', Role.User, { mustChangePassword: true }],
      ['admin', Role.Admin, {}],
      [
        'hotelModerator',
        Role.HotelModerator,
        {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(),
          },
        },
      ],
      [
        'airlineModerator',
        Role.AirlineModerator,
        {
          assignment: {
            providerType: ProviderType.Airline,
            providerId: new Types.ObjectId(),
          },
        },
      ],
    ];
    const inserted = await users.insertMany(
      seeds.map(([label, role, extra]) => ({
        name: `ACC-12 ${label} ${RUN}`,
        email: `acc12-${label.toLowerCase()}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...extra,
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      accounts.set(seeds[index][0], {
        id: user._id.toString(),
        email: user.email,
      });
    }

    const now = Date.now();
    const post = (
      _id: Types.ObjectId,
      label: string,
      title: string,
      fields: object = {},
    ) => {
      createdPostIds.push(_id);
      return {
        _id,
        authorId: new Types.ObjectId(idOf(label)),
        title,
        body: `A post of the ACC-12 e2e test, ${RUN}.`,
        status: PostStatus.Published,
        publishedAt: new Date(now - 1000),
        tags: [TAG],
        ...fields,
      };
    };
    await posts.insertMany([
      post(postA, 'A', `By A ${TOKEN}`),
      post(draftA, 'A', `Draft of A ${TOKEN}`, {
        status: PostStatus.Draft,
        publishedAt: undefined,
      }),
      post(postB, 'B', `By B ${TOKEN}`, { commentCount: 1 }),
    ]);
    createdCommentIds.push(commentAonB);
    await comments.insertMany([
      {
        _id: commentAonB,
        postId: postB,
        authorId: new Types.ObjectId(idOf('A')),
        body: 'A comment of A, written before leaving',
      },
    ]);
    for (const stored of await posts
      .find({ _id: { $in: [postA, draftA, postB] } })
      .select('updatedAt')
      .lean()) {
      updatedAtBefore.set(stored._id.toString(), stored.updatedAt.getTime());
    }

    const trip = (
      _id: Types.ObjectId,
      label: string,
      visibility: ItineraryVisibility,
    ) => {
      createdItineraryIds.push(_id);
      return {
        _id,
        ownerId: new Types.ObjectId(idOf(label)),
        title: `Trip of ${label} ${TOKEN}`,
        countries: ['EG'],
        startDate: '2027-01-10',
        visibility,
      };
    };
    await itineraries.insertMany([
      trip(publicTripA, 'A', ItineraryVisibility.Public),
      trip(privateTripA, 'A', ItineraryVisibility.Private),
      trip(publicTripB, 'B', ItineraryVisibility.Public),
    ]);

    sessionA = await startSession('A');
    otherSessionA = await startSession('A');
    sessionB = (await startSession('B')).access;
    adminCookie = (await startSession('admin')).access;
  });

  afterAll(async () => {
    for (const id of createdFlightBookingIds) {
      await flightBookings.findByIdAndDelete(id);
    }
    for (const id of createdHotelBookingIds) {
      await hotelBookings.findByIdAndDelete(id);
    }
    // Comments, likes and reports of these users, including any a failed
    // case created by mistake.
    for (const id of createdUserIds) {
      const userId = new Types.ObjectId(id);
      for (const { _id } of await comments
        .find({ authorId: userId })
        .select('_id')
        .lean()) {
        await comments.findByIdAndDelete(_id);
      }
      for (const { _id } of await likes.find({ userId }).select('_id').lean()) {
        await likes.findByIdAndDelete(_id);
      }
      for (const { _id } of await reports
        .find({ reporterId: userId })
        .select('_id')
        .lean()) {
        await reports.findByIdAndDelete(_id);
      }
      // Every itinerary of a test user, a clone included.
      for (const { _id } of await itineraries
        .find({ ownerId: userId })
        .select('_id')
        .lean()) {
        await itineraries.findByIdAndDelete(_id);
      }
    }
    for (const id of createdCommentIds) {
      await comments.findByIdAndDelete(id);
    }
    for (const id of createdItineraryIds) {
      await itineraries.findByIdAndDelete(id);
    }
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    await deleteAuditLogsOf(app, createdUserIds);
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('who may call it, and the body', () => {
    it('answers 401 to a guest', async () => {
      const response = await deactivate(null, { currentPassword: PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['admin', 'hotelModerator', 'airlineModerator'])(
      'answers 403 to the %s, and changes nothing',
      async (label) => {
        const cookie =
          label === 'admin' ? adminCookie : (await startSession(label)).access;

        const response = await deactivate(cookie, {
          currentPassword: PASSWORD,
        });

        expect(response.status).toBe(403);
        expect((await users.findById(idOf(label)).lean())?.status).toBe(
          UserStatus.Active,
        );
      },
    );

    it('answers 403 to a user who must change a temporary password first', async () => {
      const { access } = await startSession('temporary');

      const response = await deactivate(access, { currentPassword: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(PASSWORD_CHANGE_REQUIRED_MESSAGE);
      expect((await users.findById(idOf('temporary')).lean())?.status).toBe(
        UserStatus.Active,
      );
    });

    it('answers 400 to an empty body', async () => {
      const response = await deactivate(sessionA.access, {});

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field: 'currentPassword' }),
      ]);
      await expectNothingChanged();
    });

    it('answers 400 to a property that is not allowed', async () => {
      const response = await deactivate(sessionA.access, {
        currentPassword: PASSWORD,
        status: 'deactivated',
      });

      expect(response.status).toBe(400);
      await expectNothingChanged();
    });

    it('answers 400 to a wrong password, and changes nothing', async () => {
      const response = await deactivate(sessionA.access, {
        currentPassword: 'Wr0ngPassword',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(CURRENT_PASSWORD_INCORRECT_MESSAGE);
      await expectNothingChanged();
      // Not counted for the lockout (ACC-05).
      const stored = await users
        .findById(idOf('A'))
        .select('+failedLoginAttempts')
        .lean();
      expect(stored?.failedLoginAttempts ?? 0).toBe(0);
    });
  });

  describe('what blocks it', () => {
    const inAnHour = () => new Date(Date.now() + HOUR_MS);

    it('answers 409 while A has a confirmed flight booking', async () => {
      await withFlightBooking(
        flightBooking('A', FlightBookingStatus.Confirmed),
        async () => {
          const response = await deactivate(sessionA.access, {
            currentPassword: PASSWORD,
          });

          expect(response.status).toBe(409);
          expect(response.body.message).toBe(
            ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE,
          );
          await expectNothingChanged();
        },
      );
    });

    it('answers 409 while A has a confirmed hotel reservation', async () => {
      await withHotelBooking(
        hotelBooking('A', HotelBookingStatus.Confirmed),
        async () => {
          const response = await deactivate(sessionA.access, {
            currentPassword: PASSWORD,
          });

          expect(response.status).toBe(409);
          expect(response.body.message).toBe(
            ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE,
          );
          await expectNothingChanged();
        },
      );
    });

    it('answers 409 with the unpaid message while a flight hold of A is live', async () => {
      await withFlightBooking(
        flightBooking('A', FlightBookingStatus.PendingPayment, inAnHour()),
        async () => {
          const response = await deactivate(sessionA.access, {
            currentPassword: PASSWORD,
          });

          expect(response.status).toBe(409);
          expect(response.body.message).toBe(
            ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE,
          );
          await expectNothingChanged();
        },
      );
    });

    it('answers 409 with the unpaid message while a hotel hold of A is live', async () => {
      await withHotelBooking(
        hotelBooking('A', HotelBookingStatus.PendingPayment, inAnHour()),
        async () => {
          const response = await deactivate(sessionA.access, {
            currentPassword: PASSWORD,
          });

          expect(response.status).toBe(409);
          expect(response.body.message).toBe(
            ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE,
          );
          await expectNothingChanged();
        },
      );
    });
  });

  describe('a successful deactivation', () => {
    let response: request.Response;
    let startedAt = 0;

    beforeAll(async () => {
      // None of these blocks it: bookings that are over, expired or
      // cancelled, holds that have ended, and another user's confirmed
      // booking.
      const anHourAgo = new Date(Date.now() - HOUR_MS);
      await flightBookings.insertMany([
        flightBooking('A', FlightBookingStatus.Completed),
        flightBooking('A', FlightBookingStatus.Expired, anHourAgo),
        flightBooking('A', FlightBookingStatus.Cancelled),
        flightBooking('A', FlightBookingStatus.PendingPayment, anHourAgo),
        flightBooking('C', FlightBookingStatus.Confirmed),
      ]);
      await hotelBookings.insertMany([
        hotelBooking('A', HotelBookingStatus.Completed),
        hotelBooking('A', HotelBookingStatus.Expired, anHourAgo),
        hotelBooking('A', HotelBookingStatus.Cancelled),
        hotelBooking('A', HotelBookingStatus.PendingPayment, anHourAgo),
        hotelBooking('C', HotelBookingStatus.Confirmed),
      ]);

      startedAt = Date.now();
      response = await deactivate(sessionA.access, {
        currentPassword: PASSWORD,
      });
    });

    it('answers 204 with no body, past bookings, ended holds and other users bookings do not block it', () => {
      expect(response.status).toBe(204);
      expect(response.text).toBe('');
    });

    it('clears both authentication cookies', () => {
      const lines = setCookieLines(response);
      for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
        const line = lines.find((candidate) =>
          candidate.startsWith(`${name}=`),
        );
        expect(line).toBeDefined();
        expect(line?.startsWith(`${name}=;`)).toBe(true);
        expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
      }
    });

    it('stores the account as deactivated, with the moment', async () => {
      const stored = await users.findById(idOf('A')).lean();

      expect(stored?.status).toBe(UserStatus.Deactivated);
      expect(stored?.deactivatedAt).toBeInstanceOf(Date);
      const at = stored?.deactivatedAt?.getTime() ?? 0;
      expect(at).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(at).toBeLessThanOrEqual(Date.now());
    });

    it('ends the session that made the request: its cookies get 401', async () => {
      expect((await myAccount(sessionA.access)).status).toBe(401);
      const refreshed = await server()
        .post('/api/auth/refresh')
        .set('Cookie', sessionA.refresh);
      expect(refreshed.status).toBe(401);
    });

    it('ends every other session of the account', async () => {
      expect((await myAccount(otherSessionA.access)).status).toBe(401);
      const refreshed = await server()
        .post('/api/auth/refresh')
        .set('Cookie', otherSessionA.refresh);
      expect(refreshed.status).toBe(401);
    });

    it('refuses the login with the right password, with the plain login message', async () => {
      const again = await login('A');

      expect(again.status).toBe(401);
      expect(again.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    });

    it('cannot be reopened by an admin', async () => {
      const reopened = await server()
        .patch(`/api/admin/accounts/${idOf('A')}/reactivate`)
        .set('Cookie', adminCookie);

      expect(reopened.status).toBe(409);
      expect((await users.findById(idOf('A')).lean())?.status).toBe(
        UserStatus.Deactivated,
      );
    });

    it('answers 401 to a second request with the old cookies', async () => {
      const second = await deactivate(sessionA.access, {
        currentPassword: PASSWORD,
      });

      expect(second.status).toBe(401);
    });

    it('cancels nothing: the bookings of A keep their status', async () => {
      const stored = await flightBookings
        .find({ userId: new Types.ObjectId(idOf('A')) })
        .select('status')
        .lean();
      const statuses = stored.map((booking) => booking.status);

      expect(statuses).toHaveLength(4);
      expect(statuses).toEqual(
        expect.arrayContaining([
          FlightBookingStatus.Completed,
          FlightBookingStatus.Expired,
          FlightBookingStatus.Cancelled,
        ]),
      );
      // The ended hold stays pending, unless the expiry job expired it meanwhile.
      expect(statuses).not.toContain(FlightBookingStatus.Confirmed);
    });
  });

  describe('the posts of a deactivated author', () => {
    it('answers 404 for the post page, to a guest and to another user', async () => {
      expect((await openPost(postA)).status).toBe(404);
      const asB = await openPost(postA).set('Cookie', sessionB);
      expect(asB.status).toBe(404);
    });

    it('leaves the post out of the public list, the tag list and the search', async () => {
      const newest = await server().get('/api/posts').query({ limit: 50 });
      const byTag = await server().get(`/api/tags/${TAG}/posts`);
      const search = await server().get('/api/posts').query({ q: TOKEN });
      const searchByTag = await server().get('/api/posts').query({ tag: TAG });

      for (const list of [newest, byTag, search, searchByTag]) {
        expect(list.status).toBe(200);
        const ids = (list.body.items as SummaryRow[]).map((row) => row.id);
        expect(ids).not.toContain(postA.toString());
        expect(ids).not.toContain(draftA.toString());
      }
      // B's post is still public in each of them.
      for (const list of [newest, byTag, search, searchByTag]) {
        const ids = (list.body.items as SummaryRow[]).map((row) => row.id);
        expect(ids).toContain(postB.toString());
      }
    });

    it('answers 404 for the author page, which therefore lists no post', async () => {
      const page = await server().get(`/api/authors/${idOf('A')}`);

      expect(page.status).toBe(404);
      expect(page.body.posts).toBeUndefined();
    });

    it('answers 404 to a comment, a like and a report of another user', async () => {
      const comment = await server()
        .post(`/api/posts/${postA.toString()}/comments`)
        .set('Cookie', sessionB)
        .send({ body: 'Hello?' });
      const like = await server()
        .post(`/api/posts/${postA.toString()}/like`)
        .set('Cookie', sessionB);
      const report = await server()
        .post('/api/reports')
        .set('Cookie', sessionB)
        .send({
          targetType: 'post',
          targetId: postA.toString(),
          reason: 'Checking a deactivated author',
        });

      expect(comment.status).toBe(404);
      expect(like.status).toBe(404);
      expect(report.status).toBe(404);
    });

    it("keeps B's post public", async () => {
      expect((await openPost(postB)).status).toBe(200);
    });

    it("flags A's posts, the draft included, and not B's, without moving updatedAt", async () => {
      const stored = await posts
        .find({ _id: { $in: [postA, draftA, postB] } })
        .select('authorDeactivated updatedAt status')
        .lean();
      const byId = new Map(stored.map((one) => [one._id.toString(), one]));

      expect(byId.get(postA.toString())?.authorDeactivated).toBe(true);
      expect(byId.get(draftA.toString())?.authorDeactivated).toBe(true);
      expect(byId.get(draftA.toString())?.status).toBe(PostStatus.Draft);
      expect(byId.get(postB.toString())?.authorDeactivated).toBe(false);
      for (const id of [postA, draftA, postB]) {
        expect(byId.get(id.toString())?.updatedAt.getTime()).toBe(
          updatedAtBefore.get(id.toString()),
        );
      }
    });
  });

  describe('the itineraries of a deactivated owner', () => {
    it('leaves the public itinerary out of the public search', async () => {
      const found = await server()
        .get('/api/itineraries/public/search')
        .query({ q: TOKEN, limit: 50 });

      expect(found.status).toBe(200);
      const ids = (found.body.items as SummaryRow[]).map((row) => row.id);
      expect(ids).not.toContain(publicTripA.toString());
      expect(ids).toContain(publicTripB.toString());
    });

    it('answers 404 to the public view, the clone and a report', async () => {
      const view = await server().get(
        `/api/itineraries/public/${publicTripA.toString()}`,
      );
      const clone = await server()
        .post(`/api/itineraries/${publicTripA.toString()}/clone`)
        .set('Cookie', sessionB);
      const report = await server()
        .post('/api/reports')
        .set('Cookie', sessionB)
        .send({
          targetType: 'itinerary',
          targetId: publicTripA.toString(),
          reason: 'Checking a deactivated owner',
        });

      expect(view.status).toBe(404);
      expect(clone.status).toBe(404);
      expect(report.status).toBe(404);
    });

    it("keeps B's public itinerary open", async () => {
      const view = await server().get(
        `/api/itineraries/public/${publicTripB.toString()}`,
      );

      expect(view.status).toBe(200);
    });

    it('keeps the private itinerary of A, and flags both of A only', async () => {
      const stored = await itineraries
        .find({ _id: { $in: [publicTripA, privateTripA, publicTripB] } })
        .select('authorDeactivated visibility')
        .lean();
      const byId = new Map(stored.map((one) => [one._id.toString(), one]));

      expect(byId.get(privateTripA.toString())).toMatchObject({
        visibility: ItineraryVisibility.Private,
        authorDeactivated: true,
      });
      expect(byId.get(publicTripA.toString())?.authorDeactivated).toBe(true);
      expect(byId.get(publicTripB.toString())?.authorDeactivated).toBe(false);
    });
  });

  describe('the comments of a deactivated author', () => {
    it('keeps the comment on the post of B, under "Deleted user", and the count', async () => {
      const page = await openPost(postB);

      expect(page.status).toBe(200);
      expect(page.body.commentCount).toBe(1);
      const items = page.body.comments.items as {
        id: string;
        author: { id: string; name: string };
      }[];
      const comment = items.find((item) => item.id === commentAonB.toString());
      expect(comment?.author).toEqual({
        id: idOf('A'),
        name: DELETED_USER_NAME,
      });
    });
  });

  describe('Swagger', () => {
    it('documents DELETE /api/users/me with its answers and a body of only currentPassword', async () => {
      const response = await server().get('/api/docs-json');
      expect(response.status).toBe(200);

      const operation = response.body.paths['/api/users/me'].delete as {
        tags: string[];
        responses: Record<string, unknown>;
        requestBody: {
          content: Record<string, { schema: { $ref: string } }>;
        };
      };
      expect(operation.tags).toEqual(['users']);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['204', '400', '401', '403', '409']),
      );
      const ref = operation.requestBody.content['application/json'].schema.$ref;
      const name = ref.split('/').pop() ?? '';
      expect(
        Object.keys(response.body.components.schemas[name].properties),
      ).toEqual(['currentPassword']);
    });
  });
});
