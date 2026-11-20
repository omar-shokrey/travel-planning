import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  INVALID_VERIFICATION_LINK_MESSAGE,
  VERIFICATION_EMAIL_SENT_MESSAGE,
  VERIFICATION_RESEND_TOO_SOON_MESSAGE,
} from './../src/auth/auth.constants';
import { AuthTokenType } from './../src/auth/enums/auth-token-type.enum';
import { AuthToken } from './../src/auth/models/auth-token.schema';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { MAIL_TRANSPORT } from './../src/notifications/email.constants';
import { EmailService } from './../src/notifications/email.service';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { FakeMailTransport } from './support/fake-mail-transport';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `acc02-${randomUUID().slice(0, 8)}`;
const PASSWORD = 'Passw0rdOK';
const TOKEN_IN_LINK = /\/verify-email\?token=([A-Za-z0-9_-]+)/;

const uniqueEmail = (label: string) =>
  `${RUN}-${label}-${randomUUID().slice(0, 6)}@example.com`;

/** The routes that book (ACC-02 blocks them) and the ones that only read. */
const BOOKING_ROUTES = [
  '/api/flight-bookings',
  '/api/flight-bookings/hold',
  '/api/hotel-bookings',
] as const;
const READ_ROUTES = [
  '/api/flight-bookings',
  '/api/hotel-bookings',
  '/api/auth/me',
] as const;

/** Builds the app; with a fake transport the API sends email, without one it does not. */
async function startApp(
  mail?: FakeMailTransport,
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (mail) {
    builder = builder.overrideProvider(MAIL_TRANSPORT).useValue(mail);
  }
  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app);
  setupSwagger(app);
  await app.init();
  return app;
}

/**
 * ACC-02 end to end, on the "-test" database. The API sends email through a
 * FakeMailTransport, so nothing reaches a mail server, and the token is read
 * from the link in the collected email. Every user, session and auth_tokens
 * document is deleted by id at the end.
 */
describe('Email verification (e2e, ACC-02)', () => {
  const mail = new FakeMailTransport();
  let app: NestExpressApplication;
  let users: Model<User>;
  let authTokens: Model<AuthToken>;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());

  /** Registers through the API and waits for the background email. */
  const register = async (label: string, extra: object = {}) => {
    const email = uniqueEmail(label);
    const response = await http()
      .post('/api/auth/register')
      .send({
        name: `${RUN} ${label}`,
        email,
        password: PASSWORD,
        acceptedTerms: true,
        ...extra,
      });
    if (response.status === 201) {
      userIds.push((response.body as { id: string }).id);
    }
    await app.get(EmailService).whenIdle();
    return { response, email };
  };

  /** The tokens of the links emailed to an address, oldest first. */
  const tokensSentTo = (address: string): string[] =>
    mail.to(address).map((sent) => {
      const match = TOKEN_IN_LINK.exec(sent.text);
      if (!match) throw new Error('No verification link in the email');
      return match[1];
    });

  const login = async (email: string): Promise<string> => {
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(200);
    const header: unknown = response.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header : [])
      .map((line) => String(line).split(';')[0])
      .join('; ');
    expect(cookie).toContain(`${ACCESS_TOKEN_COOKIE}=`);
    return cookie;
  };

  const verify = (token: string) =>
    http().get('/api/auth/verify-email').query({ token });

  const resend = (cookie?: string) => {
    const call = http().post('/api/auth/resend-verification');
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /**
   * Makes the last link of the account look two minutes old, so the
   * once-a-minute limit of a new link allows one now. Its own token, by id.
   */
  const ageLastLink = async (userId: string) => {
    const [stored] = await authTokens
      .find({ userId: new Types.ObjectId(userId) })
      .select('_id')
      .lean()
      .exec();
    await authTokens
      .updateOne(
        { _id: stored._id },
        { $set: { updatedAt: new Date(Date.now() - 2 * 60_000) } },
        { timestamps: false },
      )
      .exec();
  };

  const createStaff = async (label: string, role: Role) => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: uniqueEmail(label),
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    userIds.push(created._id.toString());
    return sessionCookieFor(app, created._id.toString());
  };

  beforeAll(async () => {
    app = await startApp(mail);
    users = app.get<Model<User>>(getModelToken(User.name));
    authTokens = app.get<Model<AuthToken>>(getModelToken(AuthToken.name));
    await authTokens.init();
  });

  afterAll(async () => {
    if (!app) return;
    for (const userId of userIds) {
      for (const { _id } of await authTokens
        .find({ userId: new Types.ObjectId(userId) })
        .select('_id')
        .lean()
        .exec()) {
        await authTokens.findByIdAndDelete(_id).exec();
      }
      await deleteSessionsOf(app, userId);
      await users.findByIdAndDelete(userId).exec();
    }
    await app.close();
  });

  it('creates the account unverified and sends exactly one email with the link and its lifetime, storing only the hash', async () => {
    const { response, email } = await register('first');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ email, emailVerified: false });
    const sent = mail.to(email);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Verify your email address');
    expect(sent[0].text).toContain('expires in 24 hours');
    const [token] = tokensSentTo(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await authTokens
      .find({ userId: new Types.ObjectId(response.body.id as string) })
      .lean()
      .exec();
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe(AuthTokenType.EmailVerification);
    expect(JSON.stringify(stored)).not.toContain(token);
    const hoursLeft =
      (stored[0].expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);
  });

  it('lets the unverified account log in and read, refuses every booking route with 403, then lets the same requests pass the guard after the link', async () => {
    const { email } = await register('booker');
    const cookie = await login(email);

    for (const path of READ_ROUTES) {
      const read = await http().get(path).set('Cookie', cookie);
      expect(`${path} ${read.status}`).toBe(`${path} 200`);
    }
    const me = await http().get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.emailVerified).toBe(false);
    for (const path of BOOKING_ROUTES) {
      const refused = await http().post(path).set('Cookie', cookie).send({});
      expect(`${path} ${refused.status}`).toBe(`${path} 403`);
      expect(refused.body.message).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
    }

    const [token] = tokensSentTo(email);
    const verified = await verify(token);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ verified: true });
    expect(
      (await http().get('/api/auth/me').set('Cookie', cookie)).body
        .emailVerified,
    ).toBe(true);

    // The guard lets the same requests through now; their empty body then
    // fails validation in the pipe, so no booking is made.
    for (const path of BOOKING_ROUTES) {
      const passed = await http().post(path).set('Cookie', cookie).send({});
      expect(`${path} ${passed.status}`).toBe(`${path} 400`);
      expect(passed.body.message).toBe('Validation failed');
    }
  });

  it('refuses the same link a second time with the one 400 message', async () => {
    const { email } = await register('twice');
    const [token] = tokensSentTo(email);

    expect((await verify(token)).status).toBe(200);
    const again = await verify(token);

    expect(again.status).toBe(400);
    expect(again.body.message).toBe(INVALID_VERIFICATION_LINK_MESSAGE);
  });

  it('sends a new link on request: the old one answers 400 and the new one works', async () => {
    const { response: registered, email } = await register('resend');
    const cookie = await login(email);
    await ageLastLink(registered.body.id as string);

    const response = await resend(cookie);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ message: VERIFICATION_EMAIL_SENT_MESSAGE });
    await app.get(EmailService).whenIdle();

    const [first, second] = tokensSentTo(email);
    expect(mail.to(email)).toHaveLength(2);
    expect(second).not.toBe(first);
    const old = await verify(first);
    expect(old.status).toBe(400);
    expect(old.body.message).toBe(INVALID_VERIFICATION_LINK_MESSAGE);
    expect((await verify(second)).status).toBe(200);
  });

  it('answers 429 to a new link asked for within a minute of the last one, and sends nothing', async () => {
    const { email } = await register('flood');
    const cookie = await login(email);

    // The link of the registration is seconds old.
    const tooSoon = await resend(cookie);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.message).toBe(VERIFICATION_RESEND_TOO_SOON_MESSAGE);

    // Two at the same moment, a minute later: one link, never two.
    const me = await http().get('/api/auth/me').set('Cookie', cookie);
    await ageLastLink(me.body.id as string);
    const answers = await Promise.all([resend(cookie), resend(cookie)]);
    await app.get(EmailService).whenIdle();

    expect(answers.map((answer) => answer.status).sort()).toEqual([202, 429]);
    expect(mail.to(email)).toHaveLength(2);
  });

  it('refuses an expired link with the same 400', async () => {
    const { response, email } = await register('expired');
    const [token] = tokensSentTo(email);
    const [stored] = await authTokens
      .find({ userId: new Types.ObjectId(response.body.id as string) })
      .lean()
      .exec();
    await authTokens
      .updateOne(
        { _id: stored._id },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      )
      .exec();

    const expired = await verify(token);

    expect(expired.status).toBe(400);
    expect(expired.body.message).toBe(INVALID_VERIFICATION_LINK_MESSAGE);
    expect(
      (await users.findById(response.body.id).lean().exec())?.emailVerified,
    ).toBe(false);
  });

  it('refuses a made-up token with the same 400, and a missing or too long one as a bad request', async () => {
    const garbage = await verify('not-a-real-token');
    expect(garbage.status).toBe(400);
    expect(garbage.body.message).toBe(INVALID_VERIFICATION_LINK_MESSAGE);

    const missing = await http().get('/api/auth/verify-email');
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([
      {
        field: 'token',
        messages: expect.arrayContaining(['token is required']),
      },
    ]);
    expect((await verify('a'.repeat(129))).status).toBe(400);
  });

  it('answers 409 to a new link for a verified account', async () => {
    const { email } = await register('verified');
    const [token] = tokensSentTo(email);
    expect((await verify(token)).status).toBe(200);
    const cookie = await login(email);

    const response = await resend(cookie);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(EMAIL_ALREADY_VERIFIED_MESSAGE);
    expect(mail.to(email)).toHaveLength(1);
  });

  it('answers 401 to a guest and 403 to a moderator and an administrator asking for a new link', async () => {
    expect((await resend()).status).toBe(401);
    for (const role of [Role.HotelModerator, Role.Admin]) {
      const cookie = await createStaff(role, role);
      expect((await resend(cookie)).status).toBe(403);
    }
  });

  it('lets an account stored without the field (made before ACC-02) pass the guard of a booking route: the schema default reads it as verified', async () => {
    const created = await users.create({
      name: `${RUN} older`,
      email: uniqueEmail('older'),
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
    });
    userIds.push(created._id.toString());
    await users
      .updateOne({ _id: created._id }, { $unset: { emailVerified: 1 } })
      .exec();
    const cookie = await sessionCookieFor(app, created._id.toString());

    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', cookie)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  it('refuses emailVerified in the registration body', async () => {
    const { response } = await register('cheat', { emailVerified: true });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      {
        field: 'emailVerified',
        messages: ['property emailVerified should not exist'],
      },
    ]);
  });

  it('documents the routes, their answers and the email-off rule in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<
        string,
        {
          summary: string;
          description: string;
          parameters?: { name: string; in: string; required: boolean }[];
          responses: Record<string, unknown>;
          security?: unknown[];
        }
      >
    >;

    const verifyRoute = paths['/api/auth/verify-email'].get;
    expect(verifyRoute.summary).toContain('ACC-02');
    expect(verifyRoute.parameters).toEqual([
      expect.objectContaining({ name: 'token', in: 'query', required: true }),
    ]);
    expect(Object.keys(verifyRoute.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );

    const resendRoute = paths['/api/auth/resend-verification'].post;
    expect(resendRoute.summary).toContain('ACC-02');
    expect(resendRoute.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(resendRoute.responses)).toEqual(
      expect.arrayContaining(['202', '401', '403', '409']),
    );

    const registerRoute = paths['/api/auth/register'].post;
    expect(registerRoute.summary).toContain('ACC-02');
    expect(registerRoute.description).toContain(
      'When email is switched off (SMTP_HOST empty), the account is created verified',
    );
  });

  describe('with email switched off (no mail transport)', () => {
    let offApp: NestExpressApplication;
    const offUserIds: string[] = [];

    beforeAll(async () => {
      offApp = await startApp();
    });

    afterAll(async () => {
      if (!offApp) return;
      for (const userId of offUserIds) {
        await users.findByIdAndDelete(userId).exec();
      }
      await offApp.close();
    });

    it('creates the account verified, creates no token and sends nothing', async () => {
      expect(offApp.get(EmailService).enabled).toBe(false);
      const email = uniqueEmail('off');

      const response = await request(offApp.getHttpServer())
        .post('/api/auth/register')
        .send({
          name: `${RUN} off`,
          email,
          password: PASSWORD,
          acceptedTerms: true,
        });

      expect(response.status).toBe(201);
      offUserIds.push(response.body.id as string);
      expect(response.body.emailVerified).toBe(true);
      await offApp.get(EmailService).whenIdle();
      expect(
        await authTokens.countDocuments({
          userId: new Types.ObjectId(response.body.id as string),
        }),
      ).toBe(0);
    });
  });
});
