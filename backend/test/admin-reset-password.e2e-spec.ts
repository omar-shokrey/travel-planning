import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { compare, hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
} from './../src/admin/admin.constants';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const TEMPORARY_PASSWORD = 'Temp0rary1';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc07a-${randomUUID()}@example.com`;

const routeFor = (id: string) => `/api/admin/users/${id}/reset-password`;

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

describe('POST /api/admin/users/:id/reset-password (e2e, ACC-07a)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let passwordHash: string;
  let adminCookie: string;

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (role: Role = Role.User): Promise<TestUser> => {
    const email = uniqueEmail();
    const user = await users.create({
      name: 'Reset Test',
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdIds.push(id);
    return { id, email };
  };

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });

  /** Logs in and returns the `Cookie` header a browser would send afterwards. */
  const loginAs = async (user: TestUser): Promise<string> => {
    const response = await login(user.email, PASSWORD);
    expect(response.status).toBe(200);
    return `${ACCESS_TOKEN_COOKIE}=${cookieValue(response, ACCESS_TOKEN_COOKIE)}`;
  };

  const reset = (
    id: string,
    body: Record<string, unknown> = { temporaryPassword: TEMPORARY_PASSWORD },
    cookie: string | undefined = adminCookie,
  ) => {
    const call = request(app.getHttpServer()).post(routeFor(id)).send(body);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    adminCookie = await loginAs(await createUser(Role.Admin));
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('a successful reset', () => {
    it('replaces the password: the temporary one logs in and the old one is refused', async () => {
      const user = await createUser();

      const response = await reset(user.id);

      expect(response.status).toBe(200);
      expect((await login(user.email, TEMPORARY_PASSWORD)).status).toBe(200);
      const old = await login(user.email, PASSWORD);
      expect(old.status).toBe(401);
      expect(old.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    });

    it('asks for a new password at the next login and stores only a hash', async () => {
      const user = await createUser();

      await reset(user.id).expect(200);

      const stored = await users
        .findById(user.id)
        .select('+passwordHash')
        .lean()
        .orFail();
      expect(stored.mustChangePassword).toBe(true);
      expect(stored.passwordHash).not.toBe(TEMPORARY_PASSWORD);
      expect(await compare(TEMPORARY_PASSWORD, stored.passwordHash)).toBe(true);
    });

    it('returns the public account, with no password in it', async () => {
      const user = await createUser();

      const response = await reset(user.id);

      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        role: 'user',
        status: 'active',
      });
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain(TEMPORARY_PASSWORD);
    });

    it.each([Role.AirlineModerator, Role.HotelModerator])(
      'resets the password of a %s',
      async (role) => {
        const moderator = await createUser(role);

        await reset(moderator.id).expect(200);

        expect((await login(moderator.email, TEMPORARY_PASSWORD)).status).toBe(
          200,
        );
      },
    );

    it('clears a login lockout, so the temporary password works at once', async () => {
      const user = await createUser();
      await users.findByIdAndUpdate(user.id, {
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 15 * 60_000),
      });

      await reset(user.id).expect(200);

      expect((await login(user.email, TEMPORARY_PASSWORD)).status).toBe(200);
    });

    it('keeps the status of the account', async () => {
      const user = await createUser();
      await users.findByIdAndUpdate(user.id, { status: UserStatus.Suspended });

      const response = await reset(user.id);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('suspended');
    });
  });

  describe('a refused reset', () => {
    it('refuses to reset an administrator', async () => {
      const admin = await createUser(Role.Admin);

      const response = await reset(admin.id);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
      );
      expect((await login(admin.email, PASSWORD)).status).toBe(200);
    });

    it('answers 404 for an account that does not exist', async () => {
      const response = await reset(new Types.ObjectId().toString());

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(ACCOUNT_NOT_FOUND_MESSAGE);
    });

    it('answers 400 for an id that is not an id', async () => {
      expect((await reset('not-an-id')).status).toBe(400);
    });

    it('refuses a temporary password that breaks the rule, and names the field', async () => {
      const user = await createUser();

      const response = await reset(user.id, { temporaryPassword: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'temporaryPassword',
          messages: [
            'temporaryPassword must be at least 8 characters and include a letter and a digit',
          ],
        },
      ]);
    });

    it('refuses a field the admin may not send', async () => {
      const user = await createUser();

      const response = await reset(user.id, {
        temporaryPassword: TEMPORARY_PASSWORD,
        mustChangePassword: false,
      });

      expect(response.status).toBe(400);
    });

    it.each([Role.User, Role.AirlineModerator, Role.HotelModerator])(
      'is closed to a %s',
      async (role) => {
        const caller = await createUser(role);
        const target = await createUser();

        const response = await reset(
          target.id,
          undefined,
          await loginAs(caller),
        );

        expect(response.status).toBe(403);
        expect((await login(target.email, PASSWORD)).status).toBe(200);
      },
    );

    it('needs a login', async () => {
      const target = await createUser();

      const response = await request(app.getHttpServer())
        .post(routeFor(target.id))
        .send({ temporaryPassword: TEMPORARY_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route =
        response.body.paths['/api/admin/users/{id}/reset-password'].post;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404']),
      );
    });
  });
});
