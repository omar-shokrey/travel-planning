import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const ROUTE = '/api/admin/accounts';

/**
 * A word only this run puts in its account names. Every list below searches
 * for it, so accounts left by other tests never change the result.
 */
const RUN = `acc14${randomUUID().slice(0, 8)}`;

/** The value of one cookie in the `Set-Cookie` lines of a response, or undefined. */
function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

interface Listed {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

describe('GET /api/admin/accounts (e2e, ACC-14)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let adminCookie: string;
  /** The accounts of this run, in the order they were created (oldest first). */
  const accounts: { id: string; email: string }[] = [];

  const createAccount = async (
    label: string,
    role: Role,
    status: UserStatus,
    createdAt: Date,
  ) => {
    const email = `${label}-${randomUUID()}@example.com`;
    const user = await users.create({
      name: `${label} ${RUN}`,
      email,
      passwordHash: await hash(PASSWORD, 4),
      role,
      status,
      consentAcceptedAt: new Date(),
      createdAt,
    });
    const id = user._id.toString();
    createdIds.push(id);
    return { id, email };
  };

  const list = (query: Record<string, string>, cookie = adminCookie) =>
    request(app.getHttpServer()).get(ROUTE).query(query).set('Cookie', cookie);

  const names = (body: { items: Listed[] }) =>
    body.items.map((item) => item.name.split(' ')[0]);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    // Five accounts one minute apart, so "newest first" has a known order.
    // One insertMany, so the set-up is a single write.
    const passwordHash = await hash(PASSWORD, 4);
    const start = Date.now() - 60 * 60_000;
    const seeds: [string, Role, UserStatus][] = [
      ['Alice', Role.User, UserStatus.Active],
      ['Bilal', Role.User, UserStatus.Suspended],
      ['Carmen', Role.AirlineModerator, UserStatus.Active],
      ['Dina', Role.HotelModerator, UserStatus.Active],
      ['Emad', Role.Admin, UserStatus.Active],
    ];
    const inserted = await users.insertMany(
      seeds.map(([label, role, status], index) => ({
        name: `${label} ${RUN}`,
        email: `${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status,
        consentAcceptedAt: new Date(),
        createdAt: new Date(start + (index + 1) * 60_000),
      })),
    );
    for (const user of inserted) {
      createdIds.push(user._id.toString());
      accounts.push({ id: user._id.toString(), email: user.email });
    }

    const emad = accounts[4];
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: emad.email, password: PASSWORD });
    expect(login.status).toBe(200);
    adminCookie = `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('the list', () => {
    it('lists every role and status, newest first, with the page information', async () => {
      const response = await list({ search: RUN });

      expect(response.status).toBe(200);
      expect(names(response.body)).toEqual([
        'Emad',
        'Dina',
        'Carmen',
        'Bilal',
        'Alice',
      ]);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 5,
        totalPages: 1,
      });
    });

    it('shows the name, email, role, status and registration date, and nothing private', async () => {
      const response = await list({ search: RUN });

      const bilal = (response.body.items as Listed[]).find(
        (item) => item.id === accounts[1].id,
      );
      expect(bilal).toEqual({
        id: accounts[1].id,
        name: `Bilal ${RUN}`,
        email: accounts[1].email,
        role: 'user',
        status: 'suspended',
        mustChangePassword: false,
        emailVerified: true,
        createdAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      });
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('failedLoginAttempts');
    });

    it('pages through the accounts', async () => {
      const response = await list({ search: RUN, page: '2', limit: '2' });

      expect(names(response.body)).toEqual(['Carmen', 'Bilal']);
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
    });

    it('answers an empty page after the last one', async () => {
      const response = await list({ search: RUN, page: '9' });

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.meta.total).toBe(5);
    });
  });

  describe('search and filters', () => {
    it('searches part of the name, in any letter case', async () => {
      const response = await list({ search: `carmen ${RUN.toUpperCase()}` });

      expect(names(response.body)).toEqual(['Carmen']);
    });

    it('searches part of the email', async () => {
      const local = accounts[3].email.split('@')[0];

      const response = await list({ search: local.toUpperCase() });

      expect(names(response.body)).toEqual(['Dina']);
    });

    it('filters by role', async () => {
      const response = await list({ search: RUN, role: 'user' });

      expect(names(response.body)).toEqual(['Bilal', 'Alice']);
    });

    it('filters by status', async () => {
      const response = await list({ search: RUN, status: 'suspended' });

      expect(names(response.body)).toEqual(['Bilal']);
    });

    it('applies all the filters together', async () => {
      const response = await list({
        search: RUN,
        role: 'user',
        status: 'active',
      });

      expect(names(response.body)).toEqual(['Alice']);
    });

    it('answers an empty list when nothing matches', async () => {
      const response = await list({
        search: RUN,
        role: 'hotel_moderator',
        status: 'suspended',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('treats the search as plain text, not as a pattern', async () => {
      const response = await list({ search: `${RUN}.*` });

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
    });
  });

  describe('a refused list', () => {
    it.each([
      ['a role that does not exist', { role: 'guest' }],
      ['a status that does not exist', { status: 'banned' }],
      ['a page size over 50', { limit: '51' }],
      ['a parameter that is not allowed', { sort: 'name' }],
    ])('answers 400 for %s', async (_name, query) => {
      const response = await list(query);

      expect(response.status).toBe(400);
      expect(response.body.errors).toHaveLength(1);
    });

    it.each([Role.User, Role.AirlineModerator, Role.HotelModerator])(
      'is closed to a %s',
      async (role) => {
        const caller = await createAccount(
          'Caller',
          role,
          UserStatus.Active,
          new Date(),
        );
        const login = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: caller.email, password: PASSWORD });
        const cookie = `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`;

        expect((await list({ search: RUN }, cookie)).status).toBe(403);
      },
    );

    it('needs a login', async () => {
      const response = await request(app.getHttpServer()).get(ROUTE);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route, its filters and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].get;
      const parameters = (route.parameters as { name: string }[]).map(
        (parameter) => parameter.name,
      );
      expect(parameters).toEqual(
        expect.arrayContaining(['page', 'limit', 'search', 'role', 'status']),
      );
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
    });
  });
});
