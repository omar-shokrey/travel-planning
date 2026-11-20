import './support/auth-env';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { IS_PUBLIC_KEY } from './../src/common/decorators/public.decorator';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

/** Any well-formed id: the login guard answers before an id is looked up. */
const SOME_ID = '6741a2b3c4d5e6f708192a3b';

/** The metadata keys that `@Controller()` and `@Get()`, `@Post()`, ... set. */
const PATH_KEY = 'path';
const METHOD_KEY = 'method';

/** The methods this test can send. */
const SENDABLE = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HttpMethod = (typeof SENDABLE)[number];

/** The supertest call for each method. */
const VERBS = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

/**
 * The only routes that change data and are open to a guest on purpose: the
 * account routes a guest needs to get a session, and the Stripe webhook, which
 * is checked by its signature and not by a login. A new public route that
 * changes data must be added here, so that making a restricted action public
 * is never an accident.
 */
const PUBLIC_WRITES: ReadonlySet<string> = new Set([
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/refresh',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/payments/webhook',
]);

/**
 * Areas that hold private data. No route under one of these is public, so a
 * guest cannot read someone's bookings, payments, notifications, favourites
 * or account.
 * Public itineraries are the one exception (ITN-21).
 */
const PRIVATE_AREAS = [
  // BON-02: a user's favourites.
  '/api/favourites',
  '/api/flight-bookings',
  '/api/hotel-bookings',
  '/api/payments',
  '/api/refunds',
  '/api/notifications',
  '/api/users',
  '/api/admin',
  '/api/itineraries',
] as const;
const PUBLIC_ITINERARY_PREFIX = '/api/itineraries/public/';

interface Route {
  method: HttpMethod;
  /** With the global prefix and `:param` placeholders, as in section 8. */
  path: string;
  /** For example `POST /api/hotels/:id/rooms`. */
  label: string;
  isPublic: boolean;
}

const asList = (path: string | string[] | undefined): string[] =>
  Array.isArray(path) ? path : [path ?? ''];

const joinPath = (...parts: string[]): string =>
  `/${parts
    .join('/')
    .split('/')
    .filter((part) => part !== '')
    .join('/')}`;

const isSendable = (name: string | undefined): name is HttpMethod =>
  SENDABLE.some((method) => method === name);

/** The same URL with every `:param` filled in. */
const withIds = (path: string): string =>
  path.replace(/:[A-Za-z0-9_]+/g, SOME_ID);

/** An operation in the Swagger document: only the part these tests read. */
interface SwaggerOperation {
  responses?: Record<string, unknown>;
}

/**
 * ACC-10: a guest who tries a restricted action (book, review, post) is sent
 * to login. The redirect to the login page and back to the action is the
 * frontend's job (Milestone 2). What the backend owes the frontend is a clear,
 * identical answer on every restricted route: 401 "You must log in to do this".
 *
 * These tests read the route table of the running app instead of a hand-made
 * list, so a booking, review or post route added later is checked without
 * anyone remembering to add it here.
 */
describe('Guests and restricted actions (e2e, ACC-10)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let routes: Route[];
  let passwordHash: string;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];

  const discoverRoutes = (): Route[] => {
    const reflector = app.get(Reflector);
    const found: Route[] = [];

    for (const wrapper of app.get(DiscoveryService).getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || typeof metatype !== 'function') {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPaths = asList(
        reflector.get<string | string[] | undefined>(PATH_KEY, metatype),
      );

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler: unknown = Object.getOwnPropertyDescriptor(
          prototype,
          name,
        )?.value;
        if (typeof handler !== 'function') {
          continue;
        }
        const methodId = reflector.get<RequestMethod | undefined>(
          METHOD_KEY,
          handler,
        );
        const method =
          methodId === undefined ? undefined : RequestMethod[methodId];
        if (!isSendable(method)) {
          continue;
        }
        const isPublic =
          reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
            handler,
            metatype,
          ]) === true;

        const methodPaths = asList(
          reflector.get<string | string[] | undefined>(PATH_KEY, handler),
        );
        for (const controllerPath of controllerPaths) {
          for (const methodPath of methodPaths) {
            const path = joinPath('api', controllerPath, methodPath);
            found.push({ method, path, label: `${method} ${path}`, isPublic });
          }
        }
      }
    }
    return found;
  };

  const send = (route: Route, cookie?: string) => {
    const call = request(app.getHttpServer())[VERBS[route.method]](
      withIds(route.path),
    );
    return cookie ? call.set('Cookie', cookie) : call;
  };

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    routes = discoverRoutes();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('finds the routes of the app, so the checks below cannot pass on an empty list', () => {
    const labels = routes.map((route) => route.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        'POST /api/auth/login',
        'GET /api/auth/me',
        'POST /api/posts',
        'POST /api/itineraries',
        'POST /api/hotels',
        'GET /api/airports',
      ]),
    );
    expect(routes.some((route) => route.isPublic)).toBe(true);
    expect(routes.some((route) => !route.isPublic)).toBe(true);
  });

  describe('a guest', () => {
    it('gets 401 "You must log in to do this" on every route that is not public', async () => {
      const failures: string[] = [];

      for (const route of routes.filter((candidate) => !candidate.isPublic)) {
        const response = await send(route);
        if (
          response.status !== 401 ||
          response.body?.message !== LOGIN_REQUIRED_MESSAGE
        ) {
          failures.push(`${route.label} answered ${response.status}`);
        }
      }

      expect(failures).toEqual([]);
    });

    it('gets the same answer with a cookie that is not a valid token', async () => {
      const failures: string[] = [];

      for (const route of routes.filter((candidate) => !candidate.isPublic)) {
        const response = await send(
          route,
          `${ACCESS_TOKEN_COOKIE}=not-a-token`,
        );
        if (
          response.status !== 401 ||
          response.body?.message !== LOGIN_REQUIRED_MESSAGE
        ) {
          failures.push(`${route.label} answered ${response.status}`);
        }
      }

      expect(failures).toEqual([]);
    });

    it('gets the standard error body', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        message: LOGIN_REQUIRED_MESSAGE,
        path: '/api/auth/me',
      });
    });
  });

  describe('no restricted action is open to a guest by accident', () => {
    it('keeps every route that changes data private, except the account routes and the payment webhook', () => {
      const openWrites = routes
        .filter((route) => route.isPublic && route.method !== 'GET')
        .map((route) => route.label)
        .filter((label) => !PUBLIC_WRITES.has(label));

      expect(openWrites).toEqual([]);
    });

    it('keeps bookings, payments, refunds, notifications, accounts and private itineraries private', () => {
      const openPrivate = routes
        .filter(
          (route) =>
            route.isPublic &&
            PRIVATE_AREAS.some(
              (area) =>
                route.path === area || route.path.startsWith(`${area}/`),
            ) &&
            !route.path.startsWith(PUBLIC_ITINERARY_PREFIX) &&
            !PUBLIC_WRITES.has(route.label),
        )
        .map((route) => route.label);

      expect(openPrivate).toEqual([]);
    });
  });

  describe('a guest who logs in', () => {
    it('is refused first, then served on the same route once logged in', async () => {
      const email = `acc10-${randomUUID()}@example.com`;
      const created = await users.create({
        name: 'Guest Test',
        email,
        passwordHash,
        consentAcceptedAt: new Date(),
      });
      createdIds.push(created._id.toString());

      const refused = await request(app.getHttpServer()).get(
        '/api/itineraries',
      );
      expect(refused.status).toBe(401);
      expect(refused.body.message).toBe(LOGIN_REQUIRED_MESSAGE);

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const header: unknown = login.headers['set-cookie'];
      const cookie = (Array.isArray(header) ? header : [])
        .map((line) => String(line).split(';')[0])
        .join('; ');
      expect(cookie).toContain(`${ACCESS_TOKEN_COOKIE}=`);

      const retried = await request(app.getHttpServer())
        .get('/api/itineraries')
        .set('Cookie', cookie);
      expect(retried.status).toBe(200);
    });
  });

  describe('Swagger', () => {
    it('shows the 401 answer on every route that is not public', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const paths = response.body.paths as Record<
        string,
        Record<string, SwaggerOperation> | undefined
      >;
      const failures: string[] = [];

      for (const route of routes.filter((candidate) => !candidate.isPublic)) {
        const swaggerPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const operation = paths[swaggerPath]?.[route.method.toLowerCase()];
        if (!operation?.responses?.['401']) {
          failures.push(`${route.label} does not document 401`);
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
