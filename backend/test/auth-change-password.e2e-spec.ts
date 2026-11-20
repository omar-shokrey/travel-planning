import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { compare, hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { deleteSessionsOf } from './support/delete-sessions';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  SAME_PASSWORD_MESSAGE,
} from './../src/auth/auth.constants';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const NEW_PASSWORD = 'N3wPassword';
const ROUTE = '/api/auth/change-password';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc08-${randomUUID()}@example.com`;

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

describe('PATCH /api/auth/change-password (e2e, ACC-08)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let passwordHash: string;

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (
    fields: { role?: Role; mustChangePassword?: boolean } = {},
  ): Promise<TestUser> => {
    const email = uniqueEmail();
    const user = await users.create({
      name: 'Change Password Test',
      email,
      passwordHash,
      role: fields.role ?? Role.User,
      status: UserStatus.Active,
      mustChangePassword: fields.mustChangePassword ?? false,
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

  const changePassword = (body: Record<string, unknown>, cookie?: string) => {
    const call = request(app.getHttpServer()).patch(ROUTE).send(body);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /** One login: the cookies a browser keeps for that session. */
  interface Session {
    access: string;
    refresh: string;
  }

  /** Logs in with a real POST /api/auth/login, which starts a new session. */
  const startSession = async (
    email: string,
    password = PASSWORD,
  ): Promise<Session> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(response.status).toBe(200);
    return {
      access: `${ACCESS_TOKEN_COOKIE}=${cookieValue(response, ACCESS_TOKEN_COOKIE)}`,
      refresh: `${REFRESH_TOKEN_COOKIE}=${cookieValue(response, REFRESH_TOKEN_COOKIE)}`,
    };
  };

  /** The status of GET /api/auth/me with an access cookie. */
  const meStatus = async (access: string): Promise<number> =>
    (
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', access)
    ).status;

  /** The status of POST /api/auth/refresh with a refresh cookie. */
  const refreshStatus = async (refresh: string): Promise<number> =>
    (
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refresh)
    ).status;

  const storedHash = async (id: string): Promise<string> => {
    const user = await users.findById(id).select('+passwordHash').lean();
    return user?.passwordHash ?? '';
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
  });

  afterAll(async () => {
    // The logins made sessions (ACC-06): delete them first, one by one.
    for (const id of createdIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('a successful change', () => {
    it('saves the new password, so the next login uses it and the old one is refused', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      );

      expect(response.status).toBe(200);
      expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
      const old = await login(user.email, PASSWORD);
      expect(old.status).toBe(401);
      expect(old.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    });

    it('stores a bcrypt hash and never the plain password', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      ).expect(200);

      const stored = await storedHash(user.id);
      expect(stored).not.toBe(NEW_PASSWORD);
      expect(await compare(NEW_PASSWORD, stored)).toBe(true);
    });

    it('returns the public account, with no password hash in it', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      );

      expect(response.body).toEqual({
        id: user.id,
        name: 'Change Password Test',
        email: user.email,
        role: 'user',
        status: 'active',
        mustChangePassword: false,
        emailVerified: true,
        createdAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      });
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('ends a temporary password: mustChangePassword goes from true to false', async () => {
      const user = await createUser({ mustChangePassword: true });
      const loggedIn = await login(user.email, PASSWORD);
      expect(loggedIn.body.mustChangePassword).toBe(true);
      const cookie = `${ACCESS_TOKEN_COOKIE}=${cookieValue(loggedIn, ACCESS_TOKEN_COOKIE)}`;

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      );

      expect(response.status).toBe(200);
      expect(response.body.mustChangePassword).toBe(false);
      const stored = await users.findById(user.id).lean();
      expect(stored?.mustChangePassword).toBe(false);
    });

    it('keeps the user logged in', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      ).expect(200);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);
    });

    it('works for every role, for example a moderator', async () => {
      const user = await createUser({ role: Role.HotelModerator });
      const cookie = await loginAs(user);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      ).expect(200);
    });
  });

  describe('the other sessions of the account (ACC-06)', () => {
    it('ends every other session and keeps the one that changed the password', async () => {
      const user = await createUser();
      const sessionA = await startSession(user.email);
      const sessionB = await startSession(user.email);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        sessionA.access,
      ).expect(200);

      expect(await meStatus(sessionA.access)).toBe(200);
      expect(await meStatus(sessionB.access)).toBe(401);
      expect(await refreshStatus(sessionB.refresh)).toBe(401);
    });

    it('keeps the refresh cookie of the session that changed the password working', async () => {
      const user = await createUser();
      const sessionA = await startSession(user.email);
      await startSession(user.email);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        sessionA.access,
      ).expect(200);

      expect(await refreshStatus(sessionA.refresh)).toBe(200);
    });

    it('does not touch the sessions of another user', async () => {
      const user = await createUser();
      const other = await createUser();
      const sessionA = await startSession(user.email);
      const otherSession = await startSession(other.email);

      await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        sessionA.access,
      ).expect(200);

      expect(await meStatus(otherSession.access)).toBe(200);
      expect(await refreshStatus(otherSession.refresh)).toBe(200);
    });

    it('ends no session when the change is refused', async () => {
      const user = await createUser();
      const sessionA = await startSession(user.email);
      const sessionB = await startSession(user.email);

      await changePassword(
        { currentPassword: 'Wr0ngPassword', newPassword: NEW_PASSWORD },
        sessionA.access,
      ).expect(400);

      expect(await meStatus(sessionB.access)).toBe(200);
    });
  });

  describe('a refused change', () => {
    it('refuses a wrong current password with 400 and keeps the old password', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);
      const before = await storedHash(user.id);

      const response = await changePassword(
        { currentPassword: 'Wr0ngPassword', newPassword: NEW_PASSWORD },
        cookie,
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(CURRENT_PASSWORD_INCORRECT_MESSAGE);
      expect(await storedHash(user.id)).toBe(before);
    });

    it('refuses a new password that is the same as the current one', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        cookie,
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(SAME_PASSWORD_MESSAGE);
    });

    it('refuses a new password that breaks the rule, and names the field', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: 'short' },
        cookie,
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'newPassword',
          messages: [
            'newPassword must be at least 8 characters and include a letter and a digit',
          ],
        },
      ]);
    });

    it('refuses a field the client may not send, such as mustChangePassword', async () => {
      const user = await createUser({ mustChangePassword: true });
      const cookie = await loginAs(user);

      const response = await changePassword(
        {
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          mustChangePassword: false,
        },
        cookie,
      );

      expect(response.status).toBe(400);
      const stored = await users.findById(user.id).lean();
      expect(stored?.mustChangePassword).toBe(true);
    });

    it('needs a login', async () => {
      const response = await changePassword({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('refuses a user who was suspended after logging in', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);
      await users.findByIdAndUpdate(user.id, { status: UserStatus.Suspended });

      const response = await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      );

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
    });
  });

  describe('a temporary password must be changed first (ACC-13, ACC-07a, GEN-13)', () => {
    /** A route of another module that any logged-in user may call. */
    const otherRoute = (access?: string) => {
      const call = request(app.getHttpServer()).get('/api/notifications');
      return access ? call.set('Cookie', access) : call;
    };

    it('allows only me, change-password, refresh and logout, and refuses every other route with 403', async () => {
      const user = await createUser({ mustChangePassword: true });
      const session = await startSession(user.email);

      expect(await meStatus(session.access)).toBe(200);
      const refused = await otherRoute(session.access);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(PASSWORD_CHANGE_REQUIRED_MESSAGE);
      expect(await refreshStatus(session.refresh)).toBe(200);

      const other = await startSession(user.email);
      const logout = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', `${other.access}; ${other.refresh}`);
      expect(logout.status).toBe(204);
    });

    it('lets the same session use every route once the password is changed', async () => {
      const user = await createUser({ mustChangePassword: true });
      const { access } = await startSession(user.email);
      expect((await otherRoute(access)).status).toBe(403);

      const change = await changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        access,
      );

      expect(change.status).toBe(200);
      expect(change.body.mustChangePassword).toBe(false);
      expect((await otherRoute(access)).status).toBe(200);
    });

    it('changes nothing for an account without the flag', async () => {
      const user = await createUser({ mustChangePassword: false });
      const { access } = await startSession(user.email);

      expect((await otherRoute(access)).status).toBe(200);
      expect(await meStatus(access)).toBe(200);
    });

    it('tells a suspended account with the flag that it is suspended, on every route', async () => {
      const user = await createUser({ mustChangePassword: true });
      const { access } = await startSession(user.email);
      await users.findByIdAndUpdate(user.id, { status: UserStatus.Suspended });

      const other = await otherRoute(access);
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', access);

      for (const response of [other, me]) {
        expect(response.status).toBe(403);
        expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
      }
    });

    it('still answers a guest 401, not 403', async () => {
      const response = await otherRoute();

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route and the mustChangePassword flag of the account', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].patch;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      expect(
        response.body.components.schemas.UserResponseDto.properties,
      ).toHaveProperty('mustChangePassword');
    });
  });
});
