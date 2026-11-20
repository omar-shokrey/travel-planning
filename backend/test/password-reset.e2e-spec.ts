import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  INVALID_RESET_LINK_MESSAGE,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
} from './../src/auth/auth.constants';
import { AuthTokenType } from './../src/auth/enums/auth-token-type.enum';
import { AuthToken } from './../src/auth/models/auth-token.schema';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { MAIL_TRANSPORT } from './../src/notifications/email.constants';
import { EmailService } from './../src/notifications/email.service';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { FakeMailTransport } from './support/fake-mail-transport';

const RUN = `acc07-${randomUUID().slice(0, 8)}`;
const OLD_PASSWORD = 'Passw0rdOld';
const NEW_PASSWORD = 'N3wPassword';
const TOKEN_IN_LINK = /\/reset-password\?token=([A-Za-z0-9_-]+)/;

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

interface Account {
  id: string;
  email: string;
}

/**
 * ACC-07 end to end, on the "-test" database. The API sends email through a
 * FakeMailTransport, so nothing reaches a mail server, and the token is read
 * from the link in the collected email. Every user, session and auth_tokens
 * document is deleted by id at the end.
 */
describe('Password reset by email (e2e, ACC-07)', () => {
  const mail = new FakeMailTransport();
  let app: NestExpressApplication;
  let users: Model<User>;
  let authTokens: Model<AuthToken>;
  let oldPasswordHash: string;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());

  const createAccount = async (
    label: string,
    fields: Record<string, unknown> = {},
  ): Promise<Account> => {
    const email = `${RUN}-${label}-${randomUUID().slice(0, 6)}@example.com`;
    const created = await users.create({
      name: `${RUN} ${label}`,
      email,
      passwordHash: oldPasswordHash,
      consentAcceptedAt: new Date(),
      ...fields,
    });
    userIds.push(created._id.toString());
    return { id: created._id.toString(), email };
  };

  const forgot = async (email: string) => {
    const response = await http()
      .post('/api/auth/forgot-password')
      .send({ email });
    await app.get(EmailService).whenIdle();
    return response;
  };

  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    http().post('/api/auth/reset-password').send({ token, newPassword });

  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });

  const cookieOf = (response: request.Response): string => {
    const header: unknown = response.headers['set-cookie'];
    return (Array.isArray(header) ? header : [])
      .map((line) => String(line).split(';')[0])
      .join('; ');
  };

  /** The tokens of the reset links emailed to an address, oldest first. */
  const tokensSentTo = (address: string): string[] =>
    mail.to(address).map((sent) => {
      const match = TOKEN_IN_LINK.exec(sent.text);
      if (!match) throw new Error('No reset link in the email');
      return match[1];
    });

  const tokensOf = (userId: string) =>
    authTokens.countDocuments({ userId: new Types.ObjectId(userId) });

  beforeAll(async () => {
    oldPasswordHash = await hash(OLD_PASSWORD, 4);
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

  it('answers an existing and an unknown email with the same status and body, and emails only the existing one a 30-minute link', async () => {
    const account = await createAccount('known');
    const unknownEmail = `${RUN}-nobody@example.com`;

    const known = await forgot(account.email);
    const unknown = await forgot(unknownEmail);

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(known.body).toEqual({ message: PASSWORD_RESET_REQUESTED_MESSAGE });
    expect(unknown.body).toEqual(known.body);
    expect(mail.to(unknownEmail)).toHaveLength(0);
    const sent = mail.to(account.email);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Reset your password');
    expect(sent[0].text).toContain('expires in 30 minutes and works once');
    const [token] = tokensSentTo(account.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [stored] = await authTokens
      .find({ userId: new Types.ObjectId(account.id) })
      .lean()
      .exec();
    expect(stored.type).toBe(AuthTokenType.PasswordReset);
    expect(JSON.stringify(stored)).not.toContain(token);
    const minutesLeft = (stored.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(29.5);
    expect(minutesLeft).toBeLessThanOrEqual(30);
  });

  it.each([
    ['a suspended account', { status: UserStatus.Suspended }],
    ['a deactivated account', { status: UserStatus.Deactivated }],
    [
      'a hotel moderator',
      {
        role: Role.HotelModerator,
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      },
    ],
    [
      'an airline moderator',
      {
        role: Role.AirlineModerator,
        assignment: {
          providerType: ProviderType.Airline,
          providerId: new Types.ObjectId(),
        },
      },
    ],
    ['an administrator', { role: Role.Admin }],
  ])(
    'gives %s the same answer, and creates no token and sends nothing',
    async (label, fields) => {
      const account = await createAccount(label.replace(/\s/g, '-'), fields);

      const response = await forgot(account.email);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
      });
      expect(mail.to(account.email)).toHaveLength(0);
      expect(await tokensOf(account.id)).toBe(0);
    },
  );

  it('changes the password with the link: the old password no longer logs in, the new one does, and the email counts as verified', async () => {
    const account = await createAccount('reset', { emailVerified: false });
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    const response = await reset(token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: PASSWORD_RESET_DONE_MESSAGE });
    expect(cookieOf(response)).toBe('');
    expect((await login(account.email, OLD_PASSWORD)).status).toBe(401);
    const loggedIn = await login(account.email, NEW_PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.emailVerified).toBe(true);
  });

  it('refuses the same link a second time with the one 400 message', async () => {
    const account = await createAccount('twice');
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);
    expect((await reset(token)).status).toBe(200);

    const again = await reset(token, 'An0therPassword');

    expect(again.status).toBe(400);
    expect(again.body.message).toBe(INVALID_RESET_LINK_MESSAGE);
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('makes a newer request replace the link at once: the first answers 400, the second works', async () => {
    const account = await createAccount('newer');
    await forgot(account.email);
    await forgot(account.email);
    const [first, second] = tokensSentTo(account.email);
    expect(second).not.toBe(first);

    const old = await reset(first);
    expect(old.status).toBe(400);
    expect(old.body.message).toBe(INVALID_RESET_LINK_MESSAGE);
    expect((await reset(second)).status).toBe(200);
  });

  it('refuses an expired link with the same 400', async () => {
    const account = await createAccount('expired');
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);
    const [stored] = await authTokens
      .find({ userId: new Types.ObjectId(account.id) })
      .select('_id')
      .lean()
      .exec();
    await authTokens
      .updateOne(
        { _id: stored._id },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      )
      .exec();

    const expired = await reset(token);

    expect(expired.status).toBe(400);
    expect(expired.body.message).toBe(INVALID_RESET_LINK_MESSAGE);
    expect((await login(account.email, OLD_PASSWORD)).status).toBe(200);
  });

  it('refuses a new password that breaks the rule without using up the link, which still works after', async () => {
    const account = await createAccount('weak');
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    const weak = await reset(token, 'short1');

    expect(weak.status).toBe(400);
    expect(weak.body.errors).toEqual([
      {
        field: 'newPassword',
        messages: [
          'newPassword must be at least 8 characters and include a letter and a digit',
        ],
      },
    ]);
    expect((await reset(token)).status).toBe(200);
  });

  it('lets exactly one of two resets with the same link at the same moment win: one 200 and one 400', async () => {
    const account = await createAccount('race');
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    const answers = await Promise.all([
      reset(token, 'RaceWinner1'),
      reset(token, 'RaceWinner2'),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 400]);
    const winner = answers[0].status === 200 ? 'RaceWinner1' : 'RaceWinner2';
    expect((await login(account.email, winner)).status).toBe(200);
  });

  it('ends every session of the account: an access cookie from before the reset gets 401', async () => {
    const account = await createAccount('sessions');
    const before = cookieOf(await login(account.email, OLD_PASSWORD));
    expect(before).toContain(`${ACCESS_TOKEN_COOKIE}=`);
    expect(
      (await http().get('/api/auth/me').set('Cookie', before)).status,
    ).toBe(200);
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    expect((await reset(token)).status).toBe(200);

    expect(
      (await http().get('/api/auth/me').set('Cookie', before)).status,
    ).toBe(401);
  });

  it('unlocks a locked account: it logs in with the new password at once', async () => {
    const account = await createAccount('locked', {
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });
    expect((await login(account.email, OLD_PASSWORD)).status).toBe(429);
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    expect((await reset(token)).status).toBe(200);

    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('clears a temporary password: the account logs in with mustChangePassword false', async () => {
    const account = await createAccount('temporary', {
      mustChangePassword: true,
    });
    await forgot(account.email);
    const [token] = tokensSentTo(account.email);

    expect((await reset(token)).status).toBe(200);

    const loggedIn = await login(account.email, NEW_PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.mustChangePassword).toBe(false);
  });

  it('refuses a made-up token with the same 400, and a bad body as a bad request', async () => {
    const garbage = await reset('not-a-real-token');
    expect(garbage.status).toBe(400);
    expect(garbage.body.message).toBe(INVALID_RESET_LINK_MESSAGE);

    const noToken = await http()
      .post('/api/auth/reset-password')
      .send({ newPassword: NEW_PASSWORD });
    expect(noToken.status).toBe(400);
    expect(noToken.body.errors).toEqual([
      {
        field: 'token',
        messages: expect.arrayContaining(['token is required']),
      },
    ]);
    const notAnEmail = await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(notAnEmail.status).toBe(400);
    expect(notAnEmail.body.errors).toEqual([
      { field: 'email', messages: ['email must be an email'] },
    ]);
  });

  it('documents both routes, their answers and the same-answer rule in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<
        string,
        {
          summary: string;
          description: string;
          responses: Record<string, unknown>;
          security?: unknown[];
        }
      >
    >;

    const forgotRoute = paths['/api/auth/forgot-password'].post;
    expect(forgotRoute.summary).toContain('ACC-07');
    expect(forgotRoute.description).toContain(
      'The answer is the same 202 and the same body for every email',
    );
    expect(Object.keys(forgotRoute.responses)).toEqual(
      expect.arrayContaining(['202', '400']),
    );

    const resetRoute = paths['/api/auth/reset-password'].post;
    expect(resetRoute.summary).toContain('ACC-07');
    expect(Object.keys(resetRoute.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, { example?: string }> }
    >;
    // The admin reset (ACC-07a) keeps its own DTO and schema.
    expect(schemas).toHaveProperty('ResetForgottenPasswordDto');
    expect(schemas).toHaveProperty('ResetPasswordDto');
    expect(
      schemas.PasswordResetRequestedResponseDto.properties.message.example,
    ).toBe(PASSWORD_RESET_REQUESTED_MESSAGE);
    expect(
      schemas.PasswordResetDoneResponseDto.properties.message.example,
    ).toBe(PASSWORD_RESET_DONE_MESSAGE);
  });

  describe('with email switched off (no mail transport)', () => {
    let offApp: NestExpressApplication;

    beforeAll(async () => {
      offApp = await startApp();
    });

    afterAll(async () => {
      if (offApp) await offApp.close();
    });

    it('answers the same 202 and creates no token', async () => {
      expect(offApp.get(EmailService).enabled).toBe(false);
      const account = await createAccount('off');

      const response = await request(offApp.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: account.email });
      await offApp.get(EmailService).whenIdle();

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
      });
      expect(await tokensOf(account.id)).toBe(0);
    });
  });
});
