import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { deleteSessionsOf } from './support/delete-sessions';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { PASSWORD_CHANGE_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Temp0rary1';
const RUN = randomUUID().slice(0, 8);

type Who = 'user' | 'admin' | 'hotelModerator';

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

/**
 * ACC-13, ACC-07a, GEN-13: an account that still has a temporary password is
 * refused by every module, not only by one route. Each account below has
 * `mustChangePassword: true`; every call except GET /api/auth/me must answer
 * 403 with the same message, before any validation or database work (so no
 * request below creates anything). On the "-test" database; the accounts and
 * their sessions are deleted by id.
 */
describe('A temporary password must be changed first, on every module (e2e, ACC-13, ACC-07a)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  const createdIds: string[] = [];
  const cookies = new Map<Who, string>();
  const anyId = new Types.ObjectId().toString();

  // [method, account, path, module]
  const routes: [string, Who, string, string][] = [
    ['GET', 'user', '/api/notifications', 'notifications'],
    ['GET', 'user', '/api/users/me', 'users'],
    ['POST', 'user', '/api/flight-bookings/hold', 'flight bookings'],
    ['POST', 'user', '/api/hotel-bookings', 'hotel bookings'],
    ['GET', 'user', '/api/itineraries', 'itineraries'],
    ['POST', 'user', '/api/posts', 'blog'],
    ['GET', 'user', `/api/refunds/${anyId}`, 'refunds'],
    ['POST', 'user', '/api/payments', 'payments'],
    ['GET', 'admin', '/api/admin/accounts', 'admin'],
    ['PATCH', 'hotelModerator', `/api/hotels/${anyId}`, 'hotels'],
  ];

  const call = (method: string, path: string, cookie: string) => {
    const server = request(app.getHttpServer());
    const test =
      method === 'GET'
        ? server.get(path)
        : method === 'POST'
          ? server.post(path)
          : server.patch(path);
    return test.set('Cookie', cookie).send({});
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    users = app.get<Model<User>>(getModelToken(User.name));

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [Who, Role][] = [
      ['user', Role.User],
      ['admin', Role.Admin],
      ['hotelModerator', Role.HotelModerator],
    ];
    for (const [who, role] of accounts) {
      const email = `tpw-${RUN}-${who.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
      const created = await users.create({
        name: `Temporary password ${who}`,
        email,
        passwordHash,
        role,
        status: UserStatus.Active,
        mustChangePassword: true,
        consentAcceptedAt: new Date(),
        ...(role === Role.HotelModerator && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(anyId),
          },
        }),
      });
      createdIds.push(created._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.mustChangePassword).toBe(true);
      cookies.set(
        who,
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }
  });

  afterAll(async () => {
    if (!app) return;
    for (const id of createdIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id).exec();
    }
    await app.close();
  });

  it.each(routes)(
    '%s %s (%s) answers 403 "You must change your temporary password first"',
    async (method, who, path) => {
      const response = await call(method, path, cookies.get(who) ?? '');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(PASSWORD_CHANGE_REQUIRED_MESSAGE);
    },
  );

  it.each(['user', 'admin', 'hotelModerator'] as const)(
    'GET /api/auth/me still answers the %s 200, with the flag',
    async (who) => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookies.get(who) ?? '');

      expect(response.status).toBe(200);
      expect(response.body.mustChangePassword).toBe(true);
    },
  );
});
