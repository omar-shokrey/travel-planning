import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './support/auth-env';
import { deleteSessionsOf } from './support/delete-sessions';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { Session } from './../src/auth/models/session.schema';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const MINUTE = 60_000;

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc06-${randomUUID()}@example.com`;

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

/** The `Set-Cookie` lines of a response. */
function setCookieLines(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
}

/** The value of one cookie in the `Set-Cookie` lines, or undefined. */
function cookieValue(lines: string[], name: string): string | undefined {
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

describe('Logout, refresh and the inactivity limit (e2e, ACC-06)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let sessions: Model<Session>;
  const jwt = new JwtService();
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let passwordHash: string;
  let idleMinutes: number;

  interface TestUser {
    id: string;
    email: string;
  }

  /** What a browser holds after a login. */
  interface Login {
    user: TestUser;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    /** The `Cookie` header with both cookies. */
    cookies: string;
  }

  const createUser = async (
    fields: { status?: UserStatus } = {},
  ): Promise<TestUser> => {
    const email = uniqueEmail();
    const user = await users.create({
      name: 'Session Test',
      email,
      passwordHash,
      role: Role.User,
      status: fields.status ?? UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdIds.push(id);
    return { id, email };
  };

  const loginAs = async (user: TestUser): Promise<Login> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    const lines = setCookieLines(response);
    const accessToken = cookieValue(lines, 'access_token') ?? '';
    const refreshToken = cookieValue(lines, 'refresh_token') ?? '';
    const payload = jwt.decode<{ sid: string }>(accessToken);
    return {
      user,
      accessToken,
      refreshToken,
      sessionId: payload?.sid ?? '',
      cookies: `access_token=${accessToken}; refresh_token=${refreshToken}`,
    };
  };

  const me = (cookie?: string) => {
    const call = request(app.getHttpServer()).get('/api/auth/me');
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const refresh = (cookie?: string) => {
    const call = request(app.getHttpServer()).post('/api/auth/refresh');
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const logout = (cookie?: string) => {
    const call = request(app.getHttpServer()).post('/api/auth/logout');
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /** The session as it is stored now. */
  const stored = async (sessionId: string) => {
    const found = await sessions.findById(sessionId).lean().exec();
    if (!found) {
      throw new Error(`The session ${sessionId} is not stored`);
    }
    return found;
  };

  /** Moves the end of a session, as if the time had passed. */
  const setExpiry = (sessionId: string, expiresAt: Date) =>
    sessions.updateOne({ _id: sessionId }, { expiresAt }).exec();

  /** A token of ours, made by hand for a session id that the test chooses. */
  const handMade = (
    secret: string,
    claims: Record<string, unknown>,
    expiresIn = 60,
  ) => jwt.signAsync(claims, { secret, expiresIn });

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
    sessions = app.get<Model<Session>>(getModelToken(Session.name));
    idleMinutes = app
      .get(ConfigService)
      .getOrThrow<number>('SESSION_INACTIVITY_MINUTES');
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('login starts a session', () => {
    it('stores one for the user, with the hash of the refresh token and never a token', async () => {
      const user = await createUser();

      const login = await loginAs(user);

      const session = await stored(login.sessionId);
      expect(session.userId.toString()).toBe(user.id);
      expect(session.refreshTokenHash).toBe(sha256(login.refreshToken));
      expect(session.revokedAt).toBeUndefined();
      expect(JSON.stringify(session)).not.toContain(login.refreshToken);
      expect(JSON.stringify(session)).not.toContain(login.accessToken);
    });

    it('ends the session after the inactivity limit counted from the login', async () => {
      const user = await createUser();
      const before = Date.now();

      const login = await loginAs(user);

      const session = await stored(login.sessionId);
      expect(session.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        before - 1_000,
      );
      expect(
        session.expiresAt.getTime() - session.lastActivityAt.getTime(),
      ).toBe(idleMinutes * MINUTE);
    });

    it('names the session in both tokens', async () => {
      const user = await createUser();

      const login = await loginAs(user);

      expect(login.sessionId).toMatch(/^[0-9a-f]{24}$/);
      const refreshPayload = await jwt.verifyAsync<{ sid: string }>(
        login.refreshToken,
        { secret: TEST_REFRESH_SECRET },
      );
      expect(refreshPayload.sid).toBe(login.sessionId);
    });

    it('makes a new session for every login, so two browsers are two sessions', async () => {
      const user = await createUser();

      const first = await loginAs(user);
      const second = await loginAs(user);

      expect(first.sessionId).not.toBe(second.sessionId);
      expect(await sessions.countDocuments({ userId: user.id })).toBe(2);
    });

    it('starts no session when the login fails', async () => {
      const user = await createUser();

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Wr0ngPassword' })
        .expect(401);

      expect(await sessions.countDocuments({ userId: user.id })).toBe(0);
    });

    it('keeps the sessions in a collection with an index on the user and a TTL index on the end', async () => {
      await sessions.init();

      const indexes = await sessions.collection.indexes();

      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: { userId: 1 } }),
          expect.objectContaining({
            key: { expiresAt: 1 },
            expireAfterSeconds: 0,
          }),
        ]),
      );
    });
  });

  describe('POST /api/auth/logout', () => {
    it('answers 204 with no body and clears both cookies', async () => {
      const login = await loginAs(await createUser());

      const response = await logout(login.cookies);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      const lines = setCookieLines(response);
      expect(lines).toHaveLength(2);
      const access = lines.find((line) => line.startsWith('access_token='));
      const refreshLine = lines.find((line) =>
        line.startsWith('refresh_token='),
      );
      // A cleared cookie has no value and a date in the past, on the same path
      // it was set on, or the browser would keep it.
      expect(access).toMatch(/^access_token=;/);
      expect(access).toContain('Path=/;');
      expect(access).toContain('HttpOnly');
      expect(access).toContain('Expires=Thu, 01 Jan 1970');
      expect(refreshLine).toMatch(/^refresh_token=;/);
      expect(refreshLine).toContain('Path=/api/auth');
      expect(refreshLine).toContain('HttpOnly');
      expect(refreshLine).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('revokes the session on the server and keeps its hash', async () => {
      const login = await loginAs(await createUser());
      const before = Date.now();

      await logout(login.cookies).expect(204);

      const session = await stored(login.sessionId);
      expect(session.revokedAt?.getTime()).toBeGreaterThanOrEqual(
        before - 1_000,
      );
      expect(session.refreshTokenHash).toBe(sha256(login.refreshToken));
    });

    it('stops the access token at once, although it has not expired', async () => {
      const login = await loginAs(await createUser());
      await me(login.cookies).expect(200);

      await logout(login.cookies).expect(204);

      const response = await me(`access_token=${login.accessToken}`);
      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('stops the refresh token too', async () => {
      const login = await loginAs(await createUser());

      await logout(login.cookies).expect(204);

      const response = await refresh(`refresh_token=${login.refreshToken}`);
      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('ends only its own session: the same user stays logged in elsewhere', async () => {
      const user = await createUser();
      const laptop = await loginAs(user);
      const phone = await loginAs(user);

      await logout(laptop.cookies).expect(204);

      await me(laptop.cookies).expect(401);
      await me(phone.cookies).expect(200);
      expect((await stored(phone.sessionId)).revokedAt).toBeUndefined();
    });

    it('can be repeated: the second logout is a 204 and keeps the first time', async () => {
      const login = await loginAs(await createUser());
      await logout(login.cookies).expect(204);
      const first = (await stored(login.sessionId)).revokedAt;

      await logout(login.cookies).expect(204);

      expect((await stored(login.sessionId)).revokedAt).toEqual(first);
    });

    it('answers 204 and clears the cookies even when the browser sent none', async () => {
      const response = await logout();

      expect(response.status).toBe(204);
      expect(setCookieLines(response)).toHaveLength(2);
    });

    it('works with only the refresh cookie, the one the browser sends to /api/auth', async () => {
      const login = await loginAs(await createUser());

      await logout(`refresh_token=${login.refreshToken}`).expect(204);

      expect((await stored(login.sessionId)).revokedAt).toBeDefined();
    });

    it('works with only an access cookie that has expired, so a user can always log out', async () => {
      const login = await loginAs(await createUser());
      const expired = await handMade(
        TEST_ACCESS_SECRET,
        { sub: login.user.id, sid: login.sessionId },
        -10,
      );

      await logout(`access_token=${expired}`).expect(204);

      expect((await stored(login.sessionId)).revokedAt).toBeDefined();
    });

    it('works for an account that was suspended after the login', async () => {
      const login = await loginAs(await createUser());
      await users.findByIdAndUpdate(login.user.id, {
        status: UserStatus.Suspended,
      });

      await logout(login.cookies).expect(204);

      expect((await stored(login.sessionId)).revokedAt).toBeDefined();
    });

    it('revokes nothing for broken cookies', async () => {
      const login = await loginAs(await createUser());

      await logout('access_token=not-a-token; refresh_token=garbage').expect(
        204,
      );

      expect((await stored(login.sessionId)).revokedAt).toBeUndefined();
      await me(login.cookies).expect(200);
    });

    it('revokes nothing for a token signed with another secret, even if it names a real session', async () => {
      const login = await loginAs(await createUser());
      const forged = await handMade('a-secret-that-is-not-ours', {
        sub: login.user.id,
        sid: login.sessionId,
      });

      await logout(`access_token=${forged}; refresh_token=${forged}`).expect(
        204,
      );

      expect((await stored(login.sessionId)).revokedAt).toBeUndefined();
    });

    it('revokes nothing for a token that names the session of another user', async () => {
      const owner = await loginAs(await createUser());
      const other = await createUser();
      const mixed = await handMade(TEST_ACCESS_SECRET, {
        sub: other.id,
        sid: owner.sessionId,
      });

      await logout(`access_token=${mixed}`).expect(204);

      expect((await stored(owner.sessionId)).revokedAt).toBeUndefined();
    });
  });

  describe('the inactivity limit', () => {
    it('counts a request as activity and moves the end of the session forward', async () => {
      const login = await loginAs(await createUser());
      await setExpiry(login.sessionId, new Date(Date.now() + 2 * MINUTE));
      const before = Date.now();

      await me(login.cookies).expect(200);

      const session = await stored(login.sessionId);
      expect(session.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        before - 1_000,
      );
      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + idleMinutes * MINUTE - 1_000,
      );
    });

    it('refuses a session that had no request for the whole limit, with a valid access token', async () => {
      const login = await loginAs(await createUser());
      await setExpiry(login.sessionId, new Date(Date.now() - 1_000));

      const response = await me(login.cookies);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('does not bring a finished session back by being refused', async () => {
      const login = await loginAs(await createUser());
      const ended = new Date(Date.now() - 1_000);
      await setExpiry(login.sessionId, ended);

      await me(login.cookies).expect(401);
      await me(login.cookies).expect(401);

      expect((await stored(login.sessionId)).expiresAt).toEqual(ended);
    });

    it('does not let a finished session refresh: a new login is needed', async () => {
      const login = await loginAs(await createUser());
      await setExpiry(login.sessionId, new Date(Date.now() - 1_000));

      const response = await refresh(login.cookies);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('refuses a session that the TTL index has already deleted', async () => {
      const login = await loginAs(await createUser());
      await sessions.findByIdAndDelete(login.sessionId).exec();

      await me(login.cookies).expect(401);
      await refresh(login.cookies).expect(401);
    });

    it('lets the user log in again after a session ended', async () => {
      const user = await createUser();
      const old = await loginAs(user);
      await setExpiry(old.sessionId, new Date(Date.now() - 1_000));
      await me(old.cookies).expect(401);

      const fresh = await loginAs(user);

      await me(fresh.cookies).expect(200);
    });
  });

  describe('a valid token is not enough', () => {
    it('refuses a token that names no session (made before ACC-06)', async () => {
      const user = await createUser();
      const old = await handMade(TEST_ACCESS_SECRET, { sub: user.id });

      const response = await me(`access_token=${old}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('refuses a token that names a session of another user', async () => {
      const owner = await loginAs(await createUser());
      const other = await createUser();
      const mixed = await handMade(TEST_ACCESS_SECRET, {
        sub: other.id,
        sid: owner.sessionId,
      });

      await me(`access_token=${mixed}`).expect(401);
    });

    it('refuses a live session whose account was deleted', async () => {
      const login = await loginAs(await createUser());
      await users.findByIdAndDelete(login.user.id);

      await me(login.cookies).expect(401);
      await refresh(login.cookies).expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('needs only the refresh cookie and returns the user, with new cookies and no token in the body', async () => {
      const login = await loginAs(await createUser());

      const response = await refresh(`refresh_token=${login.refreshToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: login.user.id,
        email: login.user.email,
        role: 'user',
        status: 'active',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /passwordHash|token|eyJ/i,
      );
      const lines = setCookieLines(response);
      expect(lines).toHaveLength(2);
      expect(lines.find((line) => line.startsWith('access_token='))).toContain(
        'HttpOnly',
      );
      expect(lines.find((line) => line.startsWith('refresh_token='))).toContain(
        'Path=/api/auth',
      );
    });

    it('issues different tokens for the same session, and the new access token works', async () => {
      const login = await loginAs(await createUser());

      const response = await refresh(login.cookies);

      const lines = setCookieLines(response);
      const accessToken = cookieValue(lines, 'access_token') ?? '';
      const refreshToken = cookieValue(lines, 'refresh_token') ?? '';
      expect(accessToken).not.toBe(login.accessToken);
      expect(refreshToken).not.toBe(login.refreshToken);
      const payload = await jwt.verifyAsync<{ sid: string }>(refreshToken, {
        secret: TEST_REFRESH_SECRET,
      });
      expect(payload.sid).toBe(login.sessionId);
      await me(`access_token=${accessToken}`).expect(200);
    });

    it('replaces the stored hash with the hash of the new refresh token, and counts as activity', async () => {
      const login = await loginAs(await createUser());
      await setExpiry(login.sessionId, new Date(Date.now() + 2 * MINUTE));
      const before = Date.now();

      const response = await refresh(login.cookies);

      const newRefresh = cookieValue(setCookieLines(response), 'refresh_token');
      const session = await stored(login.sessionId);
      expect(session.refreshTokenHash).toBe(sha256(newRefresh ?? ''));
      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + idleMinutes * MINUTE - 1_000,
      );
    });

    it('works once: the old refresh token is refused after it was used', async () => {
      const login = await loginAs(await createUser());
      const first = await refresh(login.cookies);
      expect(first.status).toBe(200);

      const replay = await refresh(`refresh_token=${login.refreshToken}`);

      expect(replay.status).toBe(401);
      expect(replay.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(setCookieLines(replay)).toEqual([]);
    });

    it('keeps the chain going: each new refresh token works once in turn', async () => {
      const login = await loginAs(await createUser());
      let current = login.refreshToken;

      for (let round = 0; round < 3; round++) {
        const response = await refresh(`refresh_token=${current}`);
        expect(response.status).toBe(200);
        const next = cookieValue(setCookieLines(response), 'refresh_token');
        expect(next).toBeDefined();
        expect(next).not.toBe(current);
        current = next ?? '';
      }
      expect((await stored(login.sessionId)).refreshTokenHash).toBe(
        sha256(current),
      );
    });

    it('lets exactly one of two refreshes with the same token win', async () => {
      const login = await loginAs(await createUser());

      const responses = await Promise.all([
        refresh(`refresh_token=${login.refreshToken}`),
        refresh(`refresh_token=${login.refreshToken}`),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 401,
      ]);
    });

    it('answers 401 and sets no cookie when there is no refresh cookie', async () => {
      const response = await refresh();

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('does not take the access token for a refresh token', async () => {
      const login = await loginAs(await createUser());

      const response = await refresh(`refresh_token=${login.accessToken}`);

      expect(response.status).toBe(401);
    });

    it('refuses refresh tokens that are broken, forged, expired or without a session', async () => {
      const login = await loginAs(await createUser());
      const claims = { sub: login.user.id, sid: login.sessionId };
      const badCookies = {
        garbage: 'refresh_token=not-a-token',
        'an empty cookie': 'refresh_token=',
        'a token signed with another secret': `refresh_token=${await handMade(
          'a-secret-that-is-not-ours',
          claims,
        )}`,
        'an expired token': `refresh_token=${await handMade(
          TEST_REFRESH_SECRET,
          claims,
          -10,
        )}`,
        'a token that names no session': `refresh_token=${await handMade(
          TEST_REFRESH_SECRET,
          { sub: login.user.id },
        )}`,
        'a token of a session that does not exist': `refresh_token=${await handMade(
          TEST_REFRESH_SECRET,
          { sub: login.user.id, sid: '6740f1c2a4b5c6d7e8f90abc' },
        )}`,
        'a token with the right session but not the stored hash': `refresh_token=${await handMade(
          TEST_REFRESH_SECRET,
          claims,
        )}`,
      };

      for (const [name, cookie] of Object.entries(badCookies)) {
        const response = await refresh(cookie);
        expect([name, response.status]).toEqual([name, 401]);
        expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      }
      // None of them harmed the real session.
      await me(login.cookies).expect(200);
    });

    it('answers 403 for an account suspended after the login, and sets no cookie', async () => {
      const login = await loginAs(await createUser());
      await users.findByIdAndUpdate(login.user.id, {
        status: UserStatus.Suspended,
      });

      const response = await refresh(login.cookies);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('answers 401 for an account deactivated after the login', async () => {
      const login = await loginAs(await createUser());
      await users.findByIdAndUpdate(login.user.id, {
        status: UserStatus.Deactivated,
      });

      const response = await refresh(login.cookies);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('does not revive a session that was logged out', async () => {
      const login = await loginAs(await createUser());
      await logout(login.cookies).expect(204);

      await refresh(login.cookies).expect(401);
    });
  });

  describe('Swagger', () => {
    it('documents logout and refresh', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const paths = response.body.paths;
      expect(paths['/api/auth/logout'].post.responses).toHaveProperty('204');
      expect(paths['/api/auth/refresh'].post.responses).toHaveProperty('200');
      expect(paths['/api/auth/refresh'].post.responses).toHaveProperty('401');
      expect(paths['/api/auth/refresh'].post.responses).toHaveProperty('403');
    });
  });
});
