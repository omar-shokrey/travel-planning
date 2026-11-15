import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './support/auth-env';
import { deleteSessionsOf } from './support/delete-sessions';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { CurrentUser } from './../src/common/decorators/current-user.decorator';
import { Public } from './../src/common/decorators/public.decorator';
import { Roles } from './../src/common/decorators/roles.decorator';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import type { AuthenticatedUser } from './../src/common/interfaces/authenticated-user.interface';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc04-${randomUUID()}@example.com`;

/**
 * Throwaway routes that show what the authentication guard does to a route.
 * No real route needs a role yet.
 */
@Controller('probe-auth')
class AuthProbeController {
  @Public()
  @Get('open')
  open() {
    return { open: true };
  }

  @Get('private')
  privateRoute(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Roles(Role.Admin)
  @Get('admin')
  adminRoute() {
    return { admin: true };
  }
}

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

/** A token in the format of ours, but made by someone who has no secret. */
function unsignedToken(userId: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: userId })}.`;
}

describe('POST /api/auth/login and the authentication guard (e2e, ACC-04)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  const jwt = new JwtService();
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let passwordHash: string;

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (
    fields: { role?: Role; status?: UserStatus } = {},
  ): Promise<TestUser> => {
    const email = uniqueEmail();
    const user = await users.create({
      name: 'Login Test',
      email,
      passwordHash,
      role: fields.role ?? Role.User,
      status: fields.status ?? UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdIds.push(id);
    return { id, email };
  };

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/auth/login').send(body);

  /** Logs in and returns the `Cookie` header a browser would send afterwards. */
  const loginAs = async (user: TestUser): Promise<string> => {
    const response = await login({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    const token = cookieValue(setCookieLines(response), ACCESS_TOKEN_COOKIE);
    return `${ACCESS_TOKEN_COOKIE}=${token}`;
  };

  const get = (path: string, cookie?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /**
   * An access cookie made by hand. The session it names does not exist, so
   * the guard refuses it however well it is signed (ACC-06).
   */
  const accessCookieFor = (userId: string, secret = TEST_ACCESS_SECRET) =>
    jwt
      .signAsync(
        { sub: userId, sid: new Types.ObjectId().toString() },
        { secret, expiresIn: 60 },
      )
      .then((token) => `${ACCESS_TOKEN_COOKIE}=${token}`);

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthProbeController],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('login', () => {
    it('returns the public user and sets the two httpOnly cookies', async () => {
      const user = await createUser();

      const response = await login({ email: user.email, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: user.id,
        name: 'Login Test',
        email: user.email,
        role: 'user',
        status: 'active',
        mustChangePassword: false,
        createdAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      });

      const lines = setCookieLines(response);
      expect(lines).toHaveLength(2);
      const access = lines.find((line) => line.startsWith('access_token='));
      const refresh = lines.find((line) => line.startsWith('refresh_token='));
      expect(access).toContain('HttpOnly');
      expect(access).toMatch(/Path=\/(;|$)/);
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/auth');
    });

    it('never puts a token or the password hash in the body', async () => {
      const user = await createUser();

      const response = await login({ email: user.email, password: PASSWORD });

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(passwordHash);
      expect(body).not.toMatch(/passwordHash|token|eyJ/i);
    });

    it('issues an access token for the user that lasts ACCESS_TOKEN_MINUTES', async () => {
      const user = await createUser();
      const minutes = app
        .get(ConfigService)
        .get<number>('ACCESS_TOKEN_MINUTES');

      const response = await login({ email: user.email, password: PASSWORD });

      const lines = setCookieLines(response);
      const token = cookieValue(lines, 'access_token') ?? '';
      const payload = await jwt.verifyAsync<{
        sub: string;
        iat: number;
        exp: number;
      }>(token, { secret: TEST_ACCESS_SECRET });
      expect(payload.sub).toBe(user.id);
      expect(payload.exp - payload.iat).toBe((minutes ?? 10) * 60);
    });

    it('signs the refresh token with another secret than the access token', async () => {
      const user = await createUser();

      const response = await login({ email: user.email, password: PASSWORD });

      const lines = setCookieLines(response);
      const refresh = cookieValue(lines, 'refresh_token') ?? '';
      await expect(
        jwt.verifyAsync(refresh, { secret: TEST_REFRESH_SECRET }),
      ).resolves.toMatchObject({ sub: user.id });
      await expect(
        jwt.verifyAsync(refresh, { secret: TEST_ACCESS_SECRET }),
      ).rejects.toThrow();
    });

    it('ignores the letter case and the outer spaces of the email', async () => {
      const user = await createUser();

      const response = await login({
        email: `  ${user.email.toUpperCase()} `,
        password: PASSWORD,
      });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(user.id);
    });

    it('logs in an administrator and a moderator, and tells the role', async () => {
      const admin = await createUser({ role: Role.Admin });
      const moderator = await createUser({ role: Role.AirlineModerator });

      const adminResponse = await login({
        email: admin.email,
        password: PASSWORD,
      });
      const moderatorResponse = await login({
        email: moderator.email,
        password: PASSWORD,
      });

      expect(adminResponse.body.role).toBe('admin');
      expect(moderatorResponse.body.role).toBe('airline_moderator');
    });
  });

  describe('failed login', () => {
    it('gives one generic message for a wrong password and for an unknown email', async () => {
      const user = await createUser();

      const wrongPassword = await login({
        email: user.email,
        password: 'Wr0ngPassword',
      });
      const unknownEmail = await login({
        email: uniqueEmail(),
        password: PASSWORD,
      });

      for (const response of [wrongPassword, unknownEmail]) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
        expect(setCookieLines(response)).toEqual([]);
      }
      expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
      expect(wrongPassword.body.statusCode).toBe(unknownEmail.body.statusCode);
    });

    it('treats a deactivated account like an unknown one (ACC-12)', async () => {
      const user = await createUser({ status: UserStatus.Deactivated });

      const response = await login({ email: user.email, password: PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('tells a suspended account that it is suspended, without cookies', async () => {
      const user = await createUser({ status: UserStatus.Suspended });

      const response = await login({ email: user.email, password: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
      expect(setCookieLines(response)).toEqual([]);
    });

    it('does not show the suspension to someone who has the wrong password', async () => {
      const user = await createUser({ status: UserStatus.Suspended });

      const response = await login({
        email: user.email,
        password: 'Wr0ngPassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    });

    const invalidBodies: [string, Record<string, unknown>][] = [
      ['no body', {}],
      ['an email that is not an email', { email: 'nope', password: PASSWORD }],
      ['no password', { email: 'sara@example.com' }],
      ['an empty password', { email: 'sara@example.com', password: '' }],
      [
        'a password that is not a text',
        { email: 'sara@example.com', password: 12345678 },
      ],
      [
        'a field that is not allowed',
        { email: 'sara@example.com', password: PASSWORD, role: 'admin' },
      ],
    ];

    it.each(invalidBodies)('rejects %s with 400', async (_name, body) => {
      const response = await login(body);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(setCookieLines(response)).toEqual([]);
    });
  });

  describe('GET /api/auth/me and the guard', () => {
    it('returns the logged-in user when the cookie is sent', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      const response = await get('/api/auth/me', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        role: 'user',
        status: 'active',
      });
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('answers 401 when there is no cookie', async () => {
      const response = await get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('answers 401 for a token that is not valid', async () => {
      const user = await createUser();
      const other = await createUser({ role: Role.Admin });
      const valid = await accessCookieFor(user.id);
      const [header, , signature] = valid
        .slice(ACCESS_TOKEN_COOKIE.length + 1)
        .split('.');
      const otherPayload = (await accessCookieFor(other.id)).split('.')[1];

      const badCookies = {
        garbage: `${ACCESS_TOKEN_COOKIE}=not-a-token`,
        'an empty cookie': `${ACCESS_TOKEN_COOKIE}=`,
        'a token signed with another secret': await accessCookieFor(
          user.id,
          'another-secret-that-is-not-ours',
        ),
        'a refresh token': await accessCookieFor(user.id, TEST_REFRESH_SECRET),
        'a token with the payload of another user': `${ACCESS_TOKEN_COOKIE}=${header}.${otherPayload}.${signature}`,
        'a token with no signature (alg none)': `${ACCESS_TOKEN_COOKIE}=${unsignedToken(user.id)}`,
        'an expired token': `${ACCESS_TOKEN_COOKIE}=${await jwt.signAsync(
          { sub: user.id },
          { secret: TEST_ACCESS_SECRET, expiresIn: -10 },
        )}`,
        'a token of a user and a session that do not exist':
          await accessCookieFor(new Types.ObjectId().toString()),
        'a token with no session (made before ACC-06)': `${ACCESS_TOKEN_COOKIE}=${await jwt.signAsync(
          { sub: user.id },
          { secret: TEST_ACCESS_SECRET, expiresIn: 60 },
        )}`,
        'a token that names no user': `${ACCESS_TOKEN_COOKIE}=${await jwt.signAsync(
          {},
          { secret: TEST_ACCESS_SECRET, expiresIn: 60 },
        )}`,
      };

      for (const [name, cookie] of Object.entries(badCookies)) {
        const response = await get('/api/auth/me', cookie);
        expect([name, response.status]).toEqual([name, 401]);
        expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      }
    });

    it('stops a suspended account at once, even with a valid token', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);
      await get('/api/auth/me', cookie).expect(200);

      await users.findByIdAndUpdate(user.id, { status: UserStatus.Suspended });

      const response = await get('/api/auth/me', cookie);
      expect(response.status).toBe(403);
      expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
    });

    it('stops a deactivated account at once, even with a valid token', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);

      await users.findByIdAndUpdate(user.id, {
        status: UserStatus.Deactivated,
      });

      const response = await get('/api/auth/me', cookie);
      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('which routes need a login', () => {
    it('lets a guest reach a route marked @Public(), even with a broken cookie', async () => {
      await get('/api/probe-auth/open').expect(200, { open: true });
      await get(
        '/api/probe-auth/open',
        `${ACCESS_TOKEN_COOKIE}=not-a-token`,
      ).expect(200, { open: true });
      await get('/api/health').expect(200);
    });

    it('asks a guest to log in on every other route', async () => {
      const response = await get('/api/probe-auth/private');

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('gives @CurrentUser() the id and the role of the logged-in user', async () => {
      const user = await createUser({ role: Role.HotelModerator });
      const cookie = await loginAs(user);

      const response = await get('/api/probe-auth/private', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: user.id, role: 'hotel_moderator' });
    });

    it('runs the roles check after the login check', async () => {
      const admin = await createUser({ role: Role.Admin });
      const regular = await createUser();

      const guest = await get('/api/probe-auth/admin');
      const asRegular = await get(
        '/api/probe-auth/admin',
        await loginAs(regular),
      );
      const asAdmin = await get('/api/probe-auth/admin', await loginAs(admin));

      expect(guest.status).toBe(401);
      expect(asRegular.status).toBe(403);
      expect(asAdmin.status).toBe(200);
    });

    it('uses the role stored now, not the one the token was issued with', async () => {
      const user = await createUser();
      const cookie = await loginAs(user);
      await get('/api/probe-auth/admin', cookie).expect(403);

      await users.findByIdAndUpdate(user.id, { role: Role.Admin });

      await get('/api/probe-auth/admin', cookie).expect(200);
    });
  });

  describe('Swagger', () => {
    it('documents login and the current user, and marks /me as needing the cookie', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const paths = response.body.paths;
      expect(paths['/api/auth/login'].post.responses).toHaveProperty('200');
      expect(paths['/api/auth/login'].post.responses).toHaveProperty('401');
      expect(paths['/api/auth/login'].post.responses).toHaveProperty('403');
      expect(paths['/api/auth/login'].post.security).toBeUndefined();
      expect(paths['/api/auth/me'].get.security).toEqual([{ cookie: [] }]);
    });
  });
});
