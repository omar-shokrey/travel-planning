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
import {
  INVALID_CREDENTIALS_MESSAGE,
  accountLockedMessage,
} from './../src/auth/auth.constants';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const WRONG_PASSWORD = 'Wr0ngPassword';
const MINUTE = 60_000;

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc05-${randomUUID()}@example.com`;

/** The `Set-Cookie` lines of a response. */
function setCookieLines(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
}

describe('POST /api/auth/login lockout (e2e, ACC-05)', () => {
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
    status: UserStatus = UserStatus.Active,
  ): Promise<TestUser> => {
    const email = uniqueEmail();
    const user = await users.create({
      name: 'Lockout Test',
      email,
      passwordHash,
      role: Role.User,
      status,
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

  /** Sends `times` wrong passwords one after the other and returns the answers. */
  const failTimes = async (email: string, times: number) => {
    const responses: Awaited<ReturnType<typeof login>>[] = [];
    for (let attempt = 0; attempt < times; attempt++) {
      responses.push(await login(email, WRONG_PASSWORD));
    }
    return responses;
  };

  /** What is stored for the account: the count and the end of the lock. */
  const stored = async (id: string) => {
    const user = await users.findById(id).exec();
    return {
      attempts: user?.failedLoginAttempts,
      lockedUntil: user?.lockedUntil,
    };
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
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('counting failures', () => {
    it('answers the usual 401 for the first 4 wrong passwords and counts them', async () => {
      const user = await createUser();

      const responses = await failTimes(user.email, 4);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
      }
      const { attempts, lockedUntil } = await stored(user.id);
      expect(attempts).toBe(4);
      expect(lockedUntil).toBeUndefined();
    });

    it('resets the count on a successful login, so the failures have to be in a row', async () => {
      const user = await createUser();
      await failTimes(user.email, 4);

      const success = await login(user.email, PASSWORD);
      expect(success.status).toBe(200);
      expect((await stored(user.id)).attempts).toBe(0);

      // 4 more failures are not 8 in a row: the account stays open.
      const responses = await failTimes(user.email, 4);
      expect(responses.map((response) => response.status)).toEqual([
        401, 401, 401, 401,
      ]);
      expect((await stored(user.id)).attempts).toBe(4);
    });

    it('does not count a wrong password against another account', async () => {
      const attacked = await createUser();
      const other = await createUser();

      await failTimes(attacked.email, 5);

      expect((await stored(other.id)).attempts).toBe(0);
      expect((await login(other.email, PASSWORD)).status).toBe(200);
    });
  });

  describe('the lock', () => {
    it('locks the account on the 5th wrong password and says so in that answer', async () => {
      const user = await createUser();
      const before = Date.now();

      const responses = await failTimes(user.email, 5);

      expect(responses.slice(0, 4).map((response) => response.status)).toEqual([
        401, 401, 401, 401,
      ]);
      const locked = responses[4];
      expect(locked.status).toBe(429);
      expect(locked.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: accountLockedMessage(15),
        path: '/api/auth/login',
        timestamp: expect.any(String),
      });
      expect(setCookieLines(locked)).toEqual([]);

      const { attempts, lockedUntil } = await stored(user.id);
      expect(attempts).toBe(5);
      expect(lockedUntil).toBeInstanceOf(Date);
      const lockedFor = (lockedUntil as Date).getTime() - before;
      expect(lockedFor).toBeGreaterThan(14.5 * MINUTE);
      expect(lockedFor).toBeLessThan(15.5 * MINUTE);
    });

    it('never puts the counter or the end of the lock in the answer', async () => {
      const user = await createUser();

      const responses = await failTimes(user.email, 5);

      const body = JSON.stringify(responses[4].body);
      expect(body).not.toMatch(/lockedUntil|failedLoginAttempts/);
    });

    it('refuses the right password while the account is locked, with no cookie', async () => {
      const user = await createUser();
      await failTimes(user.email, 5);

      const response = await login(user.email, PASSWORD);

      expect(response.status).toBe(429);
      expect(response.body.message).toBe(accountLockedMessage(15));
      expect(setCookieLines(response)).toEqual([]);
    });

    it('does not count or extend anything while the account is locked', async () => {
      const user = await createUser();
      await failTimes(user.email, 5);
      const locked = await stored(user.id);

      const responses = [
        await login(user.email, WRONG_PASSWORD),
        await login(user.email, PASSWORD),
        await login(user.email, WRONG_PASSWORD),
      ];

      for (const response of responses) {
        expect(response.status).toBe(429);
      }
      expect(await stored(user.id)).toEqual(locked);
    });

    it('tells how many minutes are left, rounded up', async () => {
      const user = await createUser();
      await users.findByIdAndUpdate(user.id, {
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 3 * MINUTE),
      });

      const response = await login(user.email, PASSWORD);

      expect(response.status).toBe(429);
      expect(response.body.message).toBe(accountLockedMessage(3));
    });

    it('writes "1 minute" in the singular for the last minute', async () => {
      const user = await createUser();
      await users.findByIdAndUpdate(user.id, {
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 20_000),
      });

      const response = await login(user.email, PASSWORD);

      expect(response.status).toBe(429);
      expect(response.body.message).toBe(
        'Too many failed login attempts. Your account is locked. Try again in 1 minute.',
      );
    });

    it('does not lock any other account', async () => {
      const locked = await createUser();
      const other = await createUser();
      await failTimes(locked.email, 5);

      const response = await login(other.email, PASSWORD);

      expect(response.status).toBe(200);
    });
  });

  describe('when the lock ends', () => {
    const lockThatEnded = async (user: TestUser) => {
      await users.findByIdAndUpdate(user.id, {
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() - 1_000),
      });
    };

    it('lets the right password in, and clears the lock and the count', async () => {
      const user = await createUser();
      await lockThatEnded(user);

      const response = await login(user.email, PASSWORD);

      expect(response.status).toBe(200);
      expect(setCookieLines(response)).toHaveLength(2);
      expect(await stored(user.id)).toEqual({
        attempts: 0,
        lockedUntil: undefined,
      });
    });

    it('gives the user 5 new attempts, not just one', async () => {
      const user = await createUser();
      await lockThatEnded(user);

      const responses = await failTimes(user.email, 5);

      expect(responses.map((response) => response.status)).toEqual([
        401, 401, 401, 401, 429,
      ]);
    });
  });

  describe('accounts that are not counted', () => {
    it('never locks an email that has no account', async () => {
      const email = uniqueEmail();

      const responses = await failTimes(email, 6);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
      }
      expect(await users.exists({ email })).toBeNull();
    });

    it('never counts or locks a deactivated account (ACC-12)', async () => {
      const user = await createUser(UserStatus.Deactivated);

      const responses = await failTimes(user.email, 6);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
      }
      expect(await stored(user.id)).toEqual({
        attempts: 0,
        lockedUntil: undefined,
      });
    });

    it('does not count the right password of a suspended account', async () => {
      const user = await createUser(UserStatus.Suspended);
      await failTimes(user.email, 3);

      const response = await login(user.email, PASSWORD);

      expect(response.status).toBe(403);
      expect((await stored(user.id)).attempts).toBe(3);
    });

    it('locks a suspended account after 5 wrong passwords, and the lock comes before the suspension', async () => {
      const user = await createUser(UserStatus.Suspended);

      const responses = await failTimes(user.email, 5);
      const withRightPassword = await login(user.email, PASSWORD);

      expect(responses.map((response) => response.status)).toEqual([
        401, 401, 401, 401, 429,
      ]);
      expect(withRightPassword.status).toBe(429);
    });
  });

  describe('wrong passwords at the same moment', () => {
    it('cannot get past the limit: no more than 4 are answered with 401', async () => {
      const user = await createUser();

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => login(user.email, WRONG_PASSWORD)),
      );

      const statuses = responses.map((response) => response.status);
      // Each count is one atomic increment, so only the answers for 1, 2, 3
      // and 4 can be 401. Every other request is locked out.
      expect(statuses.filter((status) => status === 401).length).toBeLessThan(
        5,
      );
      expect(statuses.every((status) => status === 401 || status === 429)).toBe(
        true,
      );
      expect(
        statuses.filter((status) => status === 429).length,
      ).toBeGreaterThan(5);

      const { attempts, lockedUntil } = await stored(user.id);
      expect(attempts).toBeGreaterThanOrEqual(5);
      expect(lockedUntil).toBeInstanceOf(Date);
      expect((await login(user.email, PASSWORD)).status).toBe(429);
    });
  });

  describe('Swagger', () => {
    it('documents the 429 answer of login', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const responses = response.body.paths['/api/auth/login'].post.responses;
      expect(responses).toHaveProperty('429');
      expect(responses['429'].description).toMatch(/locked/i);
    });
  });
});
