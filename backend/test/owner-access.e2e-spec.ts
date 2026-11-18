import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/** A city id that no real city has. For an outsider the routes refuse before they look it up. */
const TEST_CITY = `acc11-${randomUUID()}`;
const OWNER_TITLE = 'Ownership test trip';
const OWNER_NOTES = 'Notes written by the owner';
/**
 * The tests that send every route as every outsider make 20 to 25 requests,
 * each with a few database round trips, so they get more than the default
 * 30 seconds (as in itineraries.e2e-spec.ts).
 */
const MANY_REQUESTS_TIMEOUT = 120_000;

/** The supertest call for each method these tests send. */
const VERBS = {
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;
type Verb = keyof typeof VERBS;

interface Actor {
  id: string;
  email: string;
  role: Role;
  cookie: string;
}

interface StoredItinerary {
  id: string;
  dayId: string;
}

/** One request, with a body that passes validation so that only the ownership check can refuse it. */
interface RouteCall {
  label: string;
  verb: Verb;
  path: string;
  body?: Record<string, unknown>;
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  responses?: Record<string, unknown>;
}

/**
 * ACC-11: bookings and private itineraries are for their owner. Administrators
 * may read every booking (ACC-17) and moderators the bookings of their own
 * hotel or airline (FLT-29, HTL-22), but nobody except the owner reads or
 * changes a private itinerary, whatever their role.
 *
 * Bookings do not exist yet (FLT-22 and HTL-18 come later), so these tests
 * cover what exists today: private itineraries and the own-account route. The
 * `it.todo` lines at the end mark the booking checks that the booking pull
 * requests add.
 *
 * Itineraries are for registered users only (ITN-01, ITN-21): an
 * administrator and both moderators are refused by their role (403) before
 * any lookup or id check, so they get 403 even for a missing itinerary or an
 * invalid id. Another registered user gets 403 for someone else’s
 * itinerary and 404 for a missing one.
 */
describe('Owner-only access (e2e, ACC-11)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let itineraries: Model<Itinerary>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdItineraryIds: string[] = [];

  let owner: Actor;
  let anotherUser: Actor;
  let admin: Actor;
  let airlineModerator: Actor;
  let hotelModerator: Actor;

  const http = () => request(app.getHttpServer());

  const call = (
    verb: Verb,
    path: string,
    cookie?: string,
    body?: Record<string, unknown>,
  ) => {
    const sent = http()[VERBS[verb]](path);
    const withCookie = cookie ? sent.set('Cookie', cookie) : sent;
    return body ? withCookie.send(body) : withCookie;
  };

  const send = (route: RouteCall, cookie?: string) =>
    call(route.verb, route.path, cookie, route.body);

  /** An account in the database and the cookie a browser would send after login. */
  const createActor = async (role: Role): Promise<Actor> => {
    const email = `acc11-${randomUUID()}@example.com`;
    const providerType =
      role === Role.AirlineModerator
        ? ProviderType.Airline
        : role === Role.HotelModerator
          ? ProviderType.Hotel
          : undefined;
    const user = await users.create({
      name: 'Ownership Test',
      email,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(providerType && {
        assignment: { providerType, providerId: new Types.ObjectId() },
      }),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return { id, email, role, cookie: await sessionCookieFor(app, id) };
  };

  /** An itinerary of the owner, written straight to the database, with one day. */
  const createItinerary = async (
    visibility: ItineraryVisibility,
  ): Promise<StoredItinerary> => {
    const itinerary = await itineraries.create({
      ownerId: new Types.ObjectId(owner.id),
      title: OWNER_TITLE,
      countries: ['EG'],
      startDate: '2026-12-20',
      visibility,
      days: [{ cityId: TEST_CITY, notes: OWNER_NOTES }],
      dayCount: 1,
    });
    createdItineraryIds.push(itinerary._id.toString());
    return {
      id: itinerary._id.toString(),
      dayId: itinerary.days[0]._id.toString(),
    };
  };

  /** Every route that reads or changes one itinerary. */
  const routesOf = (itinerary: StoredItinerary): RouteCall[] => [
    {
      label: 'GET /api/itineraries/:id',
      verb: 'GET',
      path: `/api/itineraries/${itinerary.id}`,
    },
    {
      label: 'PATCH /api/itineraries/:id',
      verb: 'PATCH',
      path: `/api/itineraries/${itinerary.id}`,
      body: { title: 'Taken over' },
    },
    {
      label: 'DELETE /api/itineraries/:id',
      verb: 'DELETE',
      path: `/api/itineraries/${itinerary.id}`,
    },
    {
      label: 'POST /api/itineraries/:id/days',
      verb: 'POST',
      path: `/api/itineraries/${itinerary.id}/days`,
      body: { cityId: TEST_CITY },
    },
    {
      label: 'PATCH /api/itineraries/:id/days/:dayId',
      verb: 'PATCH',
      path: `/api/itineraries/${itinerary.id}/days/${itinerary.dayId}`,
      body: { notes: 'Taken over' },
    },
  ];

  /** Everyone who is not the owner: another user and one account of every other role. */
  const outsiders = (): Actor[] => [
    anotherUser,
    admin,
    airlineModerator,
    hotelModerator,
  ];

  /** The accounts that may not use itineraries at all (ITN-01): an administrator and both moderators. */
  const staff = (): Actor[] => [admin, airlineModerator, hotelModerator];

  /**
   * The requests of the outsiders that did not get the answer they should, as
   * readable lines: another user gets `expectedForUser` (403, or 404 for a
   * missing itinerary), staff always get 403 from their role.
   */
  const wrongAnswers = async (
    itinerary: StoredItinerary,
    expectedForUser: number,
  ): Promise<string[]> => {
    const failures: string[] = [];
    for (const actor of outsiders()) {
      const expected = actor.role === Role.User ? expectedForUser : 403;
      for (const route of routesOf(itinerary)) {
        const response = await send(route, actor.cookie);
        if (response.status !== expected) {
          failures.push(
            `${actor.role}: ${route.label} answered ${response.status}`,
          );
        }
      }
    }
    return failures;
  };

  const storedItinerary = (itinerary: StoredItinerary) =>
    itineraries.findById(itinerary.id).lean().orFail();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    owner = await createActor(Role.User);
    anotherUser = await createActor(Role.User);
    admin = await createActor(Role.Admin);
    airlineModerator = await createActor(Role.AirlineModerator);
    hotelModerator = await createActor(Role.HotelModerator);
  });

  afterAll(async () => {
    for (const id of createdItineraryIds) {
      await itineraries.deleteOne({ _id: id });
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.deleteOne({ _id: id });
    }
    await app.close();
  });

  describe('GET /api/users/me', () => {
    it('returns the account of whoever is logged in, for every role', async () => {
      for (const actor of [owner, ...outsiders()]) {
        const response = await call('GET', '/api/users/me', actor.cookie);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          id: actor.id,
          email: actor.email,
          role: actor.role,
          status: 'active',
        });
      }
    });

    it('returns only the public fields of the account', async () => {
      const response = await call('GET', '/api/users/me', owner.cookie);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'mustChangePassword',
        'name',
        'role',
        'status',
      ]);
      expect(JSON.stringify(response.body)).not.toContain('not-a-real-hash');
    });

    it('returns the same account as GET /api/auth/me', async () => {
      const fromUsers = await call('GET', '/api/users/me', owner.cookie);
      const fromAuth = await call('GET', '/api/auth/me', owner.cookie);

      expect(fromUsers.status).toBe(200);
      expect(fromUsers.body).toEqual(fromAuth.body);
    });

    it('ignores an id in the query: the account always comes from the login', async () => {
      const response = await http()
        .get('/api/users/me')
        .query({ id: anotherUser.id, userId: admin.id })
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(owner.id);
    });

    it('has no route that reads another user’s account by id', async () => {
      // An administrator is the role most likely to be given such a route by mistake.
      for (const actor of [owner, admin]) {
        const response = await call(
          'GET',
          `/api/users/${anotherUser.id}`,
          actor.cookie,
        );

        // The router's own answer: no handler matched, so no record was hidden behind a 404.
        expect(response.status).toBe(404);
        expect(response.body.message).toBe(
          `Cannot GET /api/users/${anotherUser.id}`,
        );
      }
    });

    it('needs a login', async () => {
      const guest = await call('GET', '/api/users/me');
      const forged = await call(
        'GET',
        '/api/users/me',
        `${ACCESS_TOKEN_COOKIE}=not-a-token`,
      );

      for (const response of [guest, forged]) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      }
    });
  });

  describe('a private itinerary', () => {
    let itinerary: StoredItinerary;

    beforeAll(async () => {
      itinerary = await createItinerary(ItineraryVisibility.Private);
    });

    it('is open to its owner', async () => {
      const mine = await createItinerary(ItineraryVisibility.Private);

      const read = await call(
        'GET',
        `/api/itineraries/${mine.id}`,
        owner.cookie,
      );
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        id: mine.id,
        title: OWNER_TITLE,
        visibility: 'private',
      });

      const edit = await call(
        'PATCH',
        `/api/itineraries/${mine.id}`,
        owner.cookie,
        { title: 'Renamed by the owner' },
      );
      expect(edit.status).toBe(200);
      expect((await storedItinerary(mine)).title).toBe('Renamed by the owner');
    });

    it(
      'answers 403 to another user, an administrator and both moderators, on every route',
      async () => {
        expect(await wrongAnswers(itinerary, 403)).toEqual([]);
      },
      MANY_REQUESTS_TIMEOUT,
    );

    it(
      'is left exactly as it was after those refused requests',
      async () => {
        await wrongAnswers(itinerary, 403);

        const stored = await storedItinerary(itinerary);
        expect(stored.title).toBe(OWNER_TITLE);
        expect(stored.visibility).toBe(ItineraryVisibility.Private);
        expect(stored.dayCount).toBe(1);
        expect(stored.days).toHaveLength(1);
        expect(stored.days[0].notes).toBe(OWNER_NOTES);
      },
      MANY_REQUESTS_TIMEOUT,
    );

    it('does not appear in the list of anyone else', async () => {
      const others = await call('GET', '/api/itineraries', anotherUser.cookie);
      expect(others.status).toBe(200);
      expect(JSON.stringify(others.body)).not.toContain(itinerary.id);

      // Staff cannot list itineraries at all.
      for (const actor of staff()) {
        const response = await call('GET', '/api/itineraries', actor.cookie);

        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain(itinerary.id);
      }

      const mine = await call('GET', '/api/itineraries', owner.cookie);
      expect(JSON.stringify(mine.body)).toContain(itinerary.id);
    });

    it('answers 401 to a guest, on every route', async () => {
      for (const route of routesOf(itinerary)) {
        const response = await send(route);

        expect(response.status).toBe(401);
        expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      }
    });
  });

  describe('a public itinerary', () => {
    it(
      'is still the owner’s alone to open or change: others get 403 on every route',
      async () => {
        const itinerary = await createItinerary(ItineraryVisibility.Public);

        expect(await wrongAnswers(itinerary, 403)).toEqual([]);

        const stored = await storedItinerary(itinerary);
        expect(stored.title).toBe(OWNER_TITLE);
        expect(stored.visibility).toBe(ItineraryVisibility.Public);
        expect(stored.days[0].notes).toBe(OWNER_NOTES);
      },
      MANY_REQUESTS_TIMEOUT,
    );
  });

  describe('an itinerary that does not exist', () => {
    const missing: StoredItinerary = {
      id: new Types.ObjectId().toString(),
      dayId: new Types.ObjectId().toString(),
    };

    it(
      'answers 404 to the owner and another user (the ownership check comes after the lookup), and 403 to staff',
      async () => {
        expect(await wrongAnswers(missing, 404)).toEqual([]);

        for (const route of routesOf(missing)) {
          const response = await send(route, owner.cookie);
          expect(response.status).toBe(404);
        }
      },
      MANY_REQUESTS_TIMEOUT,
    );

    it('answers 400 to an id that is not a valid id, to a registered user', async () => {
      for (const actor of [owner, anotherUser]) {
        const response = await call(
          'GET',
          '/api/itineraries/not-an-id',
          actor.cookie,
        );

        expect(response.status).toBe(400);
      }
    });

    it('answers 403 to staff even for an id that is not a valid id: the role check comes first', async () => {
      for (const actor of staff()) {
        const response = await call(
          'GET',
          '/api/itineraries/not-an-id',
          actor.cookie,
        );

        expect(response.status).toBe(403);
      }
    });
  });

  describe('itineraries are for registered users only (ITN-01, ITN-21)', () => {
    it(
      'refuses staff with 403 on create, clone, and the activity and transport cost routes, and they own no itinerary afterwards',
      async () => {
        const shared = await createItinerary(ItineraryVisibility.Public);
        const routes: RouteCall[] = [
          {
            label: 'POST /api/itineraries',
            verb: 'POST',
            path: '/api/itineraries',
            body: {
              title: 'Staff trip',
              countries: ['EG'],
              startDate: '2026-12-20',
            },
          },
          {
            label: 'POST /api/itineraries/:id/clone',
            verb: 'POST',
            path: `/api/itineraries/${shared.id}/clone`,
          },
          {
            label: 'PATCH /api/activities/:id',
            verb: 'PATCH',
            path: `/api/activities/${new Types.ObjectId().toString()}`,
            body: { name: 'Taken over' },
          },
          {
            label: 'DELETE /api/transport-costs/:id',
            verb: 'DELETE',
            path: `/api/transport-costs/${new Types.ObjectId().toString()}`,
          },
        ];
        const failures: string[] = [];

        for (const actor of staff()) {
          for (const route of routes) {
            const response = await send(route, actor.cookie);
            if (response.status !== 403) {
              failures.push(
                `${actor.role}: ${route.label} answered ${response.status}`,
              );
            }
          }
        }

        expect(failures).toEqual([]);
        for (const actor of staff()) {
          expect(
            await itineraries.countDocuments({
              ownerId: new Types.ObjectId(actor.id),
            }),
          ).toBe(0);
        }
      },
      MANY_REQUESTS_TIMEOUT,
    );

    it('answers 404, not 403, to a registered user on an unknown activity or transport cost', async () => {
      const activity = await call(
        'PATCH',
        `/api/activities/${new Types.ObjectId().toString()}`,
        anotherUser.cookie,
        { name: 'Taken over' },
      );
      const transportCost = await call(
        'DELETE',
        `/api/transport-costs/${new Types.ObjectId().toString()}`,
        anotherUser.cookie,
      );

      expect(activity.status).toBe(404);
      expect(transportCost.status).toBe(404);
    });
  });

  describe('Swagger', () => {
    it('shows the 401, 403 and 404 answers of the owner-only itinerary routes', async () => {
      const response = await call('GET', '/api/docs-json');
      expect(response.status).toBe(200);

      const paths = response.body.paths as Record<
        string,
        Record<string, SwaggerOperation> | undefined
      >;
      const routes: Array<[string, string]> = [
        ['/api/itineraries/{id}', 'get'],
        ['/api/itineraries/{id}', 'patch'],
        ['/api/itineraries/{id}', 'delete'],
        ['/api/itineraries/{id}/days', 'post'],
        ['/api/itineraries/{id}/days/{dayId}', 'patch'],
      ];
      const failures: string[] = [];

      for (const [path, method] of routes) {
        const documented = Object.keys(paths[path]?.[method]?.responses ?? {});
        for (const status of ['401', '403', '404']) {
          if (!documented.includes(status)) {
            failures.push(`${method.toUpperCase()} ${path} lacks ${status}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it('shows GET /api/users/me with its answers', async () => {
      const response = await call('GET', '/api/docs-json');
      expect(response.status).toBe(200);

      const operation = response.body.paths['/api/users/me'].get;
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '401', '403']),
      );
    });
  });

  // The booking routes arrive with FLT-22, HTL-18 and the "my bookings" issues.
  // Each of those pull requests adds its own ownership checks and removes its line here.
  it.todo(
    'a flight booking is for its owner only; an administrator may read all, an airline moderator only those of their own airline (FLT-25, FLT-29, ACC-17)',
  );
  it.todo(
    'a hotel reservation is for its owner only; an administrator may read all, a hotel moderator only those of their own hotel (HTL-20, HTL-22, ACC-17)',
  );
});
