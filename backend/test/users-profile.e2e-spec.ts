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
import { Country } from './../src/reference/models/country.schema';
import { User } from './../src/users/models/user.schema';
import { UNSUPPORTED_CURRENCY_MESSAGE } from './../src/users/users.constants';

const PASSWORD = 'Passw0rdOK';
const ROUTE = '/api/users/me';

/**
 * The test database may have no reference data, so the tests add one country
 * with the ISO test currency XTS and remove it at the end. Its id is unique to
 * this run, so it never collides with a real country or another test.
 */
const TEST_COUNTRY_ID = `acc09-${randomUUID()}`;
const TEST_CURRENCY = 'XTS';
/** A currency code of the right form that no country uses. */
const UNSUPPORTED_CURRENCY = 'QQQ';

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

describe('PATCH /api/users/me (e2e, ACC-09)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let countries: Model<Country>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];
  let passwordHash: string;

  interface TestUser {
    id: string;
    email: string;
    cookie: string;
  }

  /** Creates an account with a phone and a currency, and logs it in. */
  const createUser = async (role: Role = Role.User): Promise<TestUser> => {
    const email = `acc09-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'Profile Test',
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      phone: '+20 10 1234 5678',
      preferredCurrency: TEST_CURRENCY,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdIds.push(id);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return {
      id,
      email,
      cookie: `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
    };
  };

  const update = (user: TestUser, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(ROUTE)
      .set('Cookie', user.cookie)
      .send(body);

  const stored = (user: TestUser) => users.findById(user.id).lean().orFail();

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
    countries = app.get<Model<Country>>(getModelToken(Country.name));
    await countries.create({
      _id: TEST_COUNTRY_ID,
      name: 'ACC-09 e2e test country',
      currency: TEST_CURRENCY,
    });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await countries.findByIdAndDelete(TEST_COUNTRY_ID);
    await app.close();
  });

  describe('a saved profile', () => {
    it('saves the name, the phone and the currency, and returns the profile', async () => {
      const user = await createUser();

      const response = await update(user, {
        name: 'Sara Ahmed',
        phone: '+44 20 7946 0958',
        preferredCurrency: TEST_CURRENCY,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        name: 'Sara Ahmed',
        phone: '+44 20 7946 0958',
        preferredCurrency: TEST_CURRENCY,
        role: 'user',
        status: 'active',
      });
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(await stored(user)).toMatchObject({
        name: 'Sara Ahmed',
        phone: '+44 20 7946 0958',
        preferredCurrency: TEST_CURRENCY,
      });
    });

    it('keeps the fields that were not sent', async () => {
      const user = await createUser();

      const response = await update(user, { name: 'Only The Name' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'Only The Name',
        phone: '+20 10 1234 5678',
        preferredCurrency: TEST_CURRENCY,
      });
    });

    it('trims the name and reads the currency in any letter case', async () => {
      const user = await createUser();

      const response = await update(user, {
        name: '  Sara  ',
        preferredCurrency: ' xts ',
      });

      expect(response.body).toMatchObject({
        name: 'Sara',
        preferredCurrency: TEST_CURRENCY,
      });
    });

    it('removes the phone and the currency given as null', async () => {
      const user = await createUser();

      const response = await update(user, {
        phone: null,
        preferredCurrency: null,
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('phone');
      expect(response.body).not.toHaveProperty('preferredCurrency');
      const saved = await stored(user);
      expect(saved.phone).toBeUndefined();
      expect(saved.preferredCurrency).toBeUndefined();
    });

    it('shows the new profile in GET /api/auth/me', async () => {
      const user = await createUser();
      await update(user, { name: 'Seen By Me' }).expect(200);

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', user.cookie);

      expect(me.body).toMatchObject({
        name: 'Seen By Me',
        preferredCurrency: TEST_CURRENCY,
      });
    });

    it('works for every role, for example a moderator', async () => {
      const user = await createUser(Role.AirlineModerator);

      await update(user, { name: 'Airline Mod' }).expect(200);
    });
  });

  describe('a refused profile', () => {
    it('refuses a currency that no country uses, and saves nothing', async () => {
      const user = await createUser();

      const response = await update(user, {
        name: 'Should Not Be Saved',
        preferredCurrency: UNSUPPORTED_CURRENCY,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'preferredCurrency',
          messages: [UNSUPPORTED_CURRENCY_MESSAGE],
        },
      ]);
      expect(await stored(user)).toMatchObject({
        name: 'Profile Test',
        preferredCurrency: TEST_CURRENCY,
      });
    });

    it('lists every invalid field and saves none of them', async () => {
      const user = await createUser();

      const response = await update(user, {
        name: '',
        phone: '0101234',
        preferredCurrency: 'EURO',
      });

      expect(response.status).toBe(400);
      expect(
        (response.body.errors as { field: string }[])
          .map(({ field }) => field)
          .sort(),
      ).toEqual(['name', 'phone', 'preferredCurrency']);
      expect(await stored(user)).toMatchObject({
        name: 'Profile Test',
        phone: '+20 10 1234 5678',
      });
    });

    it('refuses a valid name sent with an invalid phone, and saves neither', async () => {
      const user = await createUser();

      const response = await update(user, {
        name: 'Valid Name',
        phone: 'call me',
      });

      expect(response.status).toBe(400);
      expect((await stored(user)).name).toBe('Profile Test');
    });

    it.each([
      ['email', 'someone-else@example.com'],
      ['role', 'admin'],
      ['status', 'active'],
      ['mustChangePassword', false],
    ])('refuses to change %s', async (field, value) => {
      const user = await createUser();

      const response = await update(user, { name: 'Sara', [field]: value });

      expect(response.status).toBe(400);
      const saved = await stored(user);
      expect(saved.email).toBe(user.email);
      expect(saved.role).toBe('user');
      expect(saved.name).toBe('Profile Test');
    });

    it('needs a login', async () => {
      const response = await request(app.getHttpServer())
        .patch(ROUTE)
        .send({ name: 'Nobody' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route, its fields and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].patch;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      const { schemas } = response.body.components;
      expect(Object.keys(schemas.UpdateProfileDto.properties).sort()).toEqual([
        'name',
        'phone',
        'preferredCurrency',
      ]);
      expect(schemas.UserResponseDto.properties).toHaveProperty(
        'preferredCurrency',
      );
    });
  });
});
