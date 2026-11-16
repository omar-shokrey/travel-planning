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
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { City } from './../src/reference/models/city.schema';
import { Country } from './../src/reference/models/country.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

/**
 * The test database may have no reference data, so the tests add two
 * countries and one city in each, with ids that only this run uses, and
 * remove them at the end.
 */
const RUN = randomUUID().slice(0, 8);
const COUNTRY_A = `htl01-a-${RUN}`;
const COUNTRY_B = `htl01-b-${RUN}`;
const CITY_A = `htl01-city-a-${RUN}`;
const CITY_B = `htl01-city-b-${RUN}`;

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

const validHotel = () => ({
  name: 'HTL-01 Test Hotel',
  addressLine: '12 Nile Street',
  cityId: CITY_A,
  description: 'A hotel made by the HTL-01 e2e test.',
  starClass: 4,
  amenities: ['wifi', 'pool'],
});

describe('Hotel profiles (e2e, HTL-01)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let cities: Model<City>;
  let countries: Model<Country>;
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const cookies = new Map<string, string>();
  /** The hotel the moderator "assigned" manages, stored before the tests. */
  let managedHotelId: string;
  let otherHotelId: string;

  const call = (
    method: 'post' | 'patch',
    path: string,
    who: string | undefined,
    body: Record<string, unknown>,
  ) => {
    const pending = request(app.getHttpServer())[method](path).send(body);
    return who ? pending.set('Cookie', cookies.get(who) ?? '') : pending;
  };

  const storedHotel = () => hotels.findById(managedHotelId).lean().orFail();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    cities = app.get<Model<City>>(getModelToken(City.name));
    countries = app.get<Model<Country>>(getModelToken(Country.name));

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database (ACC-14, BLG-01).
    await countries.insertMany([
      { _id: COUNTRY_A, name: 'HTL-01 test country A', currency: 'XTS' },
      { _id: COUNTRY_B, name: 'HTL-01 test country B', currency: 'XTS' },
    ]);
    await cities.insertMany([
      { _id: CITY_A, name: 'HTL-01 test city A', countryCode: COUNTRY_A },
      { _id: CITY_B, name: 'HTL-01 test city B', countryCode: COUNTRY_B },
    ]);
    const [managed, otherHotel] = await hotels.insertMany([
      {
        ...validHotel(),
        name: 'Managed hotel',
        countryCode: COUNTRY_A,
        photos: [],
      },
      {
        ...validHotel(),
        name: 'Other managed hotel',
        countryCode: COUNTRY_A,
        photos: [],
      },
    ]);
    managedHotelId = managed._id.toString();
    otherHotelId = otherHotel._id.toString();
    createdHotelIds.push(managedHotelId, otherHotelId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['admin', Role.Admin, undefined],
      ['user', Role.User, undefined],
      ['assigned', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, otherHotel._id],
      ['airlineModerator', Role.AirlineModerator, undefined],
    ];
    const inserted = await users.insertMany(
      accounts.map(([label, role, hotelId]) => ({
        name: `HTL-01 ${label}`,
        email: `htl01-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(hotelId && {
          assignment: { providerType: ProviderType.Hotel, providerId: hotelId },
        }),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
      cookies.set(
        accounts[index][0],
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }
  });

  afterAll(async () => {
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    for (const id of [CITY_A, CITY_B]) {
      await cities.findByIdAndDelete(id);
    }
    for (const id of [COUNTRY_A, COUNTRY_B]) {
      await countries.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('an administrator creates a hotel', () => {
    it('creates an active profile and takes the country from the city', async () => {
      const response = await call('post', '/api/hotels', 'admin', validHotel());

      expect(response.status).toBe(201);
      createdHotelIds.push(response.body.id as string);
      expect(response.body).toMatchObject({
        name: 'HTL-01 Test Hotel',
        cityId: CITY_A,
        countryCode: COUNTRY_A,
        starClass: 4,
        amenities: ['wifi', 'pool'],
        photos: [],
        active: true,
        ratingCount: 0,
        averageRating: 0,
      });
      expect(response.body.createdAt).toMatch(/Z$/);
    });

    it('stores each amenity once, trimmed', async () => {
      const response = await call('post', '/api/hotels', 'admin', {
        ...validHotel(),
        amenities: ['wifi', ' pool ', 'wifi', 'pool'],
      });

      expect(response.status).toBe(201);
      createdHotelIds.push(response.body.id as string);
      expect(response.body.amenities).toEqual(['wifi', 'pool']);
    });

    it('refuses a city that is not in the reference data', async () => {
      const response = await call('post', '/api/hotels', 'admin', {
        ...validHotel(),
        cityId: `htl01-missing-${RUN}`,
      });

      expect(response.status).toBe(400);
    });

    it('refuses a field the server sets, such as the country or active', async () => {
      for (const extra of [{ countryCode: COUNTRY_B }, { active: false }]) {
        const response = await call('post', '/api/hotels', 'admin', {
          ...validHotel(),
          ...extra,
        });

        expect(response.status).toBe(400);
      }
    });

    it.each(['user', 'assigned'])('is closed to a %s', async (who) => {
      const response = await call('post', '/api/hotels', who, validHotel());

      expect(response.status).toBe(403);
    });
  });

  describe('the moderator of the hotel edits it', () => {
    it('saves the changes of the assigned moderator', async () => {
      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        'assigned',
        { description: 'Edited by its moderator', starClass: 5 },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: managedHotelId,
        description: 'Edited by its moderator',
        starClass: 5,
      });
      expect(await storedHotel()).toMatchObject({
        description: 'Edited by its moderator',
        starClass: 5,
      });
    });

    it('takes the new country when the city changes', async () => {
      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        'assigned',
        { cityId: CITY_B },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        cityId: CITY_B,
        countryCode: COUNTRY_B,
      });
    });

    it('refuses fields sent as null with 400, and saves nothing', async () => {
      const before = await storedHotel();

      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        'assigned',
        { name: null, amenities: null },
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'amenities', messages: ['amenities must not be null'] },
        { field: 'name', messages: ['name must not be null'] },
      ]);
      const after = await storedHotel();
      expect(after.name).toBe(before.name);
      expect(after.amenities).toEqual(before.amenities);
    });

    it('refuses a city that is not in the reference data', async () => {
      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        'assigned',
        { cityId: `htl01-missing-${RUN}` },
      );

      expect(response.status).toBe(400);
    });

    it('refuses a moderator of another hotel, and changes nothing', async () => {
      const before = await storedHotel();

      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        'otherModerator',
        { name: 'Taken over' },
      );

      expect(response.status).toBe(403);
      expect((await storedHotel()).name).toBe(before.name);
    });

    it.each(['admin', 'user'])(
      'refuses an edit by a %s: only the hotel moderator edits',
      async (who) => {
        const response = await call(
          'patch',
          `/api/hotels/${managedHotelId}`,
          who,
          { name: 'Not allowed' },
        );

        expect(response.status).toBe(403);
      },
    );

    it('answers 404 for a hotel that does not exist', async () => {
      const response = await call(
        'patch',
        `/api/hotels/${new Types.ObjectId().toString()}`,
        'assigned',
        { name: 'Nobody' },
      );

      expect(response.status).toBe(404);
    });

    it('needs a login', async () => {
      const response = await call(
        'patch',
        `/api/hotels/${managedHotelId}`,
        undefined,
        { name: 'Nobody' },
      );

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });
});
