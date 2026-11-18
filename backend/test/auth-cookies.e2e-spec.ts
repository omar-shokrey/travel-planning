// Before anything that loads AppModule: the test secrets and cookie settings.
import './support/auth-env';
import {
  TEST_ACCESS_TOKEN_MINUTES,
  TEST_SESSION_INACTIVITY_MINUTES,
} from './support/auth-cookie-env';
import { ConfigService } from '@nestjs/config';
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
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './../src/common/constants/cookies';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc19-${randomUUID()}@example.com`;
/** A password that follows the rule (a letter and a digit, 8 or more), new on every call. */
const newPassword = (): string => `Acc19${randomUUID().slice(0, 8)}z9`;

interface Response {
  status: number;
  text: string;
  headers: Record<string, unknown>;
}

/** The `Set-Cookie` lines of a response. */
function setCookieLines(response: Response): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
}

interface ParsedCookie {
  name: string;
  value: string;
  /** Attribute names in lower case, with their value (`true` for a flag). */
  attributes: Map<string, string | true>;
}

/** Splits one `Set-Cookie` line into its name, value and attributes. */
function parseSetCookie(line: string): ParsedCookie {
  const [pair, ...parts] = line.split(';').map((part) => part.trim());
  const equals = pair.indexOf('=');
  const attributes = new Map<string, string | true>();
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at === -1) {
      attributes.set(part.toLowerCase(), true);
    } else {
      attributes.set(part.slice(0, at).toLowerCase(), part.slice(at + 1));
    }
  }
  return {
    name: pair.slice(0, equals),
    value: pair.slice(equals + 1),
    attributes,
  };
}

/** The two cookies of a response, by name. Fails unless there are exactly these two. */
function authCookies(response: Response): {
  access: ParsedCookie;
  refresh: ParsedCookie;
} {
  const cookies = setCookieLines(response).map(parseSetCookie);
  expect(cookies.map((cookie) => cookie.name).sort()).toEqual([
    ACCESS_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
  ]);
  const byName = (name: string) =>
    cookies.find((cookie) => cookie.name === name) as ParsedCookie;
  return {
    access: byName(ACCESS_TOKEN_COOKIE),
    refresh: byName(REFRESH_TOKEN_COOKIE),
  };
}

/**
 * What a browser sends back: only the `name=value` part of each `Set-Cookie`
 * line, joined into one `Cookie` header. No supertest agent, because its
 * cookie jar refuses Secure cookies over plain http.
 */
function cookieHeaderFrom(response: Response): string {
  return setCookieLines(response)
    .map((line) => line.split(';')[0])
    .join('; ');
}

/** Checks the attributes of a cookie that was just set, with its lifetime in minutes. */
function expectIssued(cookie: ParsedCookie, path: string, minutes: number) {
  expect(cookie.value).not.toBe('');
  expect([...cookie.attributes.keys()].sort()).toEqual([
    'expires',
    'httponly',
    'max-age',
    'path',
    'samesite',
    'secure',
  ]);
  expect(cookie.attributes.get('httponly')).toBe(true);
  expect(cookie.attributes.get('secure')).toBe(true);
  expect(cookie.attributes.get('samesite')).toBe('Lax');
  expect(cookie.attributes.get('path')).toBe(path);
  expect(cookie.attributes.get('max-age')).toBe(String(minutes * 60));
  const expires = Date.parse(cookie.attributes.get('expires') as string);
  const expected = Date.now() + minutes * 60_000;
  expect(Math.abs(expires - expected)).toBeLessThan(60_000);
}

describe('Authentication cookies and no browser storage (e2e, ACC-19)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];

  interface Account {
    id: string;
    email: string;
    password: string;
  }

  const http = () => request(app.getHttpServer());

  const register = (body: Record<string, unknown>) =>
    http().post('/api/auth/register').send(body);

  /** Registers an account through the API, as the frontend does. */
  const registerAccount = async (): Promise<Account> => {
    const email = uniqueEmail();
    const password = newPassword();
    const response = await register({
      name: 'Cookie Test',
      email,
      password,
      acceptedTerms: true,
    });
    expect(response.status).toBe(201);
    const id = response.body.id as string;
    createdIds.push(id);
    return { id, email, password };
  };

  const login = (account: Pick<Account, 'email' | 'password'>) =>
    http()
      .post('/api/auth/login')
      .send({ email: account.email, password: account.password });

  /** Logs in and returns the response and the two token values. */
  const loginTokens = async (account: Account) => {
    const response = await login(account);
    expect(response.status).toBe(200);
    const { access, refresh } = authCookies(response);
    return { response, access: access.value, refresh: refresh.value };
  };

  /** The stored bcrypt hash of an account, read only to prove it never leaves the API. */
  const storedHash = async (id: string): Promise<string> =>
    (
      await users
        .findById(id)
        .select('+passwordHash')
        .lean<{ passwordHash: string }>()
        .orFail()
        .exec()
    ).passwordHash;

  beforeAll(async () => {
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
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('issues the access and refresh tokens as httpOnly, Secure, SameSite cookies at login, and only those two', async () => {
    const account = await registerAccount();

    const response = await login(account);

    expect(response.status).toBe(200);
    expect(setCookieLines(response)).toHaveLength(2);
    const { access, refresh } = authCookies(response);
    expectIssued(access, '/', TEST_ACCESS_TOKEN_MINUTES);
    expectIssued(refresh, '/api/auth', TEST_SESSION_INACTIVITY_MINUTES);
  });

  it('issues the same two cookies, with the same attributes, on refresh', async () => {
    const account = await registerAccount();
    const { refresh: refreshToken } = await loginTokens(account);

    const response = await http()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${refreshToken}`);

    expect(response.status).toBe(200);
    expect(setCookieLines(response)).toHaveLength(2);
    const { access, refresh } = authCookies(response);
    expectIssued(access, '/', TEST_ACCESS_TOKEN_MINUTES);
    expectIssued(refresh, '/api/auth', TEST_SESSION_INACTIVITY_MINUTES);
    expect(refresh.value).not.toBe(refreshToken);
  });

  it('clears both cookies at logout with the same flags and paths, an empty value and an expiry in the past', async () => {
    const account = await registerAccount();
    const { response: loggedIn } = await loginTokens(account);

    const response = await http()
      .post('/api/auth/logout')
      .set('Cookie', cookieHeaderFrom(loggedIn));

    expect(response.status).toBe(204);
    expect(setCookieLines(response)).toHaveLength(2);
    const { access, refresh } = authCookies(response);
    for (const [cookie, path] of [
      [access, '/'],
      [refresh, '/api/auth'],
    ] as const) {
      expect(cookie.value).toBe('');
      expect(cookie.attributes.get('httponly')).toBe(true);
      expect(cookie.attributes.get('secure')).toBe(true);
      expect(cookie.attributes.get('samesite')).toBe('Lax');
      expect(cookie.attributes.get('path')).toBe(path);
      expect(
        Date.parse(cookie.attributes.get('expires') as string),
      ).toBeLessThan(Date.now());
      const maxAge = cookie.attributes.get('max-age');
      expect(maxAge === undefined || Number(maxAge) <= 0).toBe(true);
    }
  });

  it('never puts a token or a credential in a body or a header other than Set-Cookie, also on errors', async () => {
    // Every response of the account's life, with the secrets known at that time.
    const email = uniqueEmail();
    const password = newPassword();
    const changedPassword = newPassword();
    const forgedToken = `forged-${randomUUID()}`;
    const responses: [string, Response][] = [];

    const registered = await register({
      name: 'Cookie Test',
      email,
      password,
      acceptedTerms: true,
    });
    expect(registered.status).toBe(201);
    const id = registered.body.id as string;
    createdIds.push(id);
    responses.push(['register', registered]);
    const firstHash = await storedHash(id);
    const account = { id, email, password };

    const loggedIn = await login(account);
    expect(loggedIn.status).toBe(200);
    responses.push(['login', loggedIn]);
    const first = authCookies(loggedIn);

    const refreshed = await http()
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${first.refresh.value}`);
    expect(refreshed.status).toBe(200);
    responses.push(['refresh', refreshed]);
    const second = authCookies(refreshed);
    const cookie = cookieHeaderFrom(refreshed);

    const me = await http().get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    responses.push(['me', me]);

    const changed = await http()
      .patch('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: changedPassword });
    expect(changed.status).toBe(200);
    responses.push(['change-password', changed]);
    const secondHash = await storedHash(id);

    const loggedOut = await http()
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(loggedOut.status).toBe(204);
    responses.push(['logout', loggedOut]);

    // The first password is wrong now: it was changed above.
    const wrongPassword = await login({ email, password });
    expect(wrongPassword.status).toBe(401);
    responses.push(['wrong password', wrongPassword]);

    const invalidBody = await register({
      name: 'Cookie Test',
      email: 'not-an-email',
      password: changedPassword,
      acceptedTerms: true,
    });
    expect(invalidBody.status).toBe(400);
    responses.push(['invalid body', invalidBody]);

    const forged = await http()
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${forgedToken}`);
    expect(forged.status).toBe(401);
    responses.push(['forged cookie', forged]);

    const suspendedPassword = newPassword();
    const suspended = await users.create({
      name: 'Cookie Test Suspended',
      email: uniqueEmail(),
      passwordHash: await hash(suspendedPassword, 4),
      status: UserStatus.Suspended,
      consentAcceptedAt: new Date(),
    });
    createdIds.push(suspended._id.toString());
    const refusedSuspended = await login({
      email: suspended.email,
      password: suspendedPassword,
    });
    expect(refusedSuspended.status).toBe(403);
    responses.push(['suspended', refusedSuspended]);
    const suspendedHash = await storedHash(suspended._id.toString());

    const secrets = [
      first.access.value,
      first.refresh.value,
      second.access.value,
      second.refresh.value,
      password,
      changedPassword,
      suspendedPassword,
      firstHash,
      secondHash,
      suspendedHash,
      'passwordHash',
      forgedToken,
    ];
    for (const [label, response] of responses) {
      const headers = Object.entries(response.headers)
        .filter(([name]) => name !== 'set-cookie')
        .map(([name, value]) => `${name}: ${String(value)}`)
        .join('\n');
      for (const secret of secrets) {
        expect([label, response.text.includes(secret)]).toEqual([label, false]);
        expect([label, headers.includes(secret)]).toEqual([label, false]);
      }
    }
  });

  describe('accepts the tokens only as cookies', () => {
    let account: Account;
    let access: string;
    let refresh: string;

    beforeAll(async () => {
      account = await registerAccount();
      ({ access, refresh } = await loginTokens(account));
    });

    it.each(['/api/auth/me', '/api/users/me'])(
      'refuses a valid access token sent any other way on %s, and accepts it as a cookie',
      async (path) => {
        const refused = [
          await http().get(path).set('Authorization', `Bearer ${access}`),
          await http().get(path).query({ access_token: access }),
          await http().get(path).query({ token: access }),
          await http()
            .get(path)
            .send({ accessToken: access, access_token: access, token: access }),
        ];
        for (const response of refused) {
          expect(response.status).toBe(401);
          expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
        }

        const accepted = await http()
          .get(path)
          .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${access}`);
        expect(accepted.status).toBe(200);
        expect(accepted.body.id).toBe(account.id);
      },
    );

    it('refuses a valid refresh token sent by Authorization or in the body, and accepts it as a cookie', async () => {
      const refused = [
        await http()
          .post('/api/auth/refresh')
          .set('Authorization', `Bearer ${refresh}`),
        await http()
          .post('/api/auth/refresh')
          .send({ refreshToken: refresh, refresh_token: refresh }),
      ];
      for (const response of refused) {
        expect(response.status).toBe(401);
        expect(setCookieLines(response)).toEqual([]);
      }

      // Last, because a refresh token works once.
      const accepted = await http()
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${refresh}`);
      expect(accepted.status).toBe(200);
      expect(accepted.body.id).toBe(account.id);
    });
  });

  it('lets the frontend learn the user from GET /api/auth/me with the cookies alone, until logout', async () => {
    const account = await registerAccount();
    const loggedIn = await login(account);
    expect(loggedIn.status).toBe(200);
    const cookie = cookieHeaderFrom(loggedIn);

    const me = await http().get('/api/auth/me').set('Cookie', cookie);

    expect(me.status).toBe(200);
    expect(me.body).toEqual(loggedIn.body);
    expect(me.body).toMatchObject({ id: account.id, email: account.email });
    for (const key of Object.keys(me.body as object)) {
      expect(key.toLowerCase()).not.toContain('token');
    }

    const loggedOut = await http()
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(loggedOut.status).toBe(204);

    // The cookies the browser had before logout no longer work (the session
    // is revoked), and the cleared ones it has after logout are empty.
    for (const sent of [cookie, cookieHeaderFrom(loggedOut)]) {
      const after = await http().get('/api/auth/me').set('Cookie', sent);
      expect(after.status).toBe(401);
      expect(after.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    }
  });

  it('never lets a foreign origin read a response with the cookies (CORS)', async () => {
    // The allowed origin (FRONTEND_URL) is checked in app.e2e-spec.ts. CORS
    // is configured with that one origin as a fixed text, so the cors package
    // names it on every answer. A browser reads a response only when this
    // header names its own origin (or `*`), so a foreign page is refused.
    const frontendUrl = app.get(ConfigService).get<string>('FRONTEND_URL');
    const foreign = 'https://evil.example';
    const account = await registerAccount();
    const { response: loggedIn } = await loginTokens(account);

    const preflight = await http()
      .options('/api/auth/me')
      .set('Origin', foreign)
      .set('Access-Control-Request-Method', 'GET');
    const real = await http()
      .get('/api/auth/me')
      .set('Origin', foreign)
      .set('Cookie', cookieHeaderFrom(loggedIn));

    for (const response of [preflight, real]) {
      const allowed = response.headers['access-control-allow-origin'];
      expect(allowed).not.toBe(foreign);
      expect(allowed).not.toBe('*');
      expect([undefined, frontendUrl]).toContain(allowed);
    }
  });

  describe('Swagger', () => {
    interface Operation {
      security?: Record<string, unknown>[];
      responses: Record<string, { headers?: Record<string, unknown> }>;
    }
    let document: {
      paths: Record<string, Record<string, Operation>>;
      components: { securitySchemes: Record<string, Record<string, unknown>> };
    };

    beforeAll(async () => {
      document = (await http().get('/api/docs-json').expect(200)).body;
    });

    it('offers only the access cookie as a security scheme, with no bearer, OAuth2 or OpenID scheme', () => {
      const schemes = document.components.securitySchemes;

      expect(Object.keys(schemes)).toEqual(['cookie']);
      expect(schemes.cookie).toEqual({
        type: 'apiKey',
        in: 'cookie',
        name: ACCESS_TOKEN_COOKIE,
      });
      for (const scheme of Object.values(schemes)) {
        expect(['http', 'oauth2', 'openIdConnect']).not.toContain(scheme.type);
      }
      // No operation asks for another scheme either.
      for (const methods of Object.values(document.paths)) {
        for (const operation of Object.values(methods)) {
          for (const requirement of operation.security ?? []) {
            expect(Object.keys(requirement)).toEqual(['cookie']);
          }
        }
      }
    });

    it.each([
      ['/api/auth/login', '200'],
      ['/api/auth/refresh', '200'],
      ['/api/auth/logout', '204'],
    ])('documents the Set-Cookie header of %s', (path, status) => {
      const operation = document.paths[path].post;

      expect(operation.responses[status].headers).toHaveProperty('Set-Cookie');
    });
  });
});
