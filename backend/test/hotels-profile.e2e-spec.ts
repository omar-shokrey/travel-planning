import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import type { Connection, Model } from 'mongoose';
import { Types as MongooseTypes } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import './support/auth-env';
import './support/uploads-env';
import { AppModule } from '../src/app.module';
import { configureApp, setupSwagger } from '../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from '../src/common/constants/cookies';
import { ProviderType } from '../src/common/enums/provider-type.enum';
import { Role } from '../src/common/enums/role.enum';
import { UserStatus } from '../src/common/enums/user-status.enum';
import { City } from '../src/reference/models/city.schema';
import { Country } from '../src/reference/models/country.schema';
import { UploadsService } from '../src/uploads/uploads.service';
import { User } from '../src/users/models/user.schema';
import { Hotel } from '../src/hotels/models/hotel.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID();
const COUNTRY_A_ID = `htl01-country-a-${RUN}`;
const COUNTRY_B_ID = `htl01-country-b-${RUN}`;
const CITY_A_ID = `htl01-city-a-${RUN}`;
const CITY_B_ID = `htl01-city-b-${RUN}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface TestAccount {
  id: string;
  cookie: string;
  email: string;
}

function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).split(';')[0];
  if (!value) {
    throw new Error(`Login response did not set the ${name} cookie`);
  }
  return value;
}

describe('Hotel profile management (real e2e, HTL-01)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let cities: Model<City>;
  let countries: Model<Country>;
  let uploads: UploadsService;
  let admin: TestAccount;
  let user: TestAccount;
  let airlineModerator: TestAccount;
  let assignedModerator: TestAccount;
  let otherHotelModerator: TestAccount;
  let assignedHotelId: string;
  let otherHotelId: string;
  let passwordHash: string;
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];

  const validBody = (cityId = CITY_A_ID, name = `Hotel ${RUN}`) => ({
    name,
    addressLine: '12 Test Street',
    cityId,
    description: 'A test hotel for the HTL-01 end-to-end tests.',
    starClass: 4,
    amenities: ['wifi', 'pool'],
  });

  const createAccount = async (
    role: Role,
    assignment?: NonNullable<User['assignment']>,
  ): Promise<TestAccount> => {
    const email = `htl01-${randomUUID()}@example.com`;
    const account = await users.create({
      name: 'HTL-01 test account',
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
      ...(assignment ? { assignment } : {}),
    });
    const id = account._id.toString();
    createdUserIds.push(id);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    return {
      id,
      email,
      cookie: `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
    };
  };

  const createHotel = async (
    account: TestAccount,
    cityId = CITY_A_ID,
    name = `Hotel ${randomUUID()}`,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', account.cookie)
      .send(validBody(cityId, name))
      .expect(201);
    const id: unknown = response.body.id;
    if (typeof id !== 'string') {
      throw new Error('Hotel create response did not include a string id');
    }
    createdHotelIds.push(id);
    return id;
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

    const connection = app.get<Connection>(getConnectionToken());
    if (!connection.name?.endsWith('-test')) {
      throw new Error(
        `HTL-01 e2e tests require a -test database, got "${connection.name}"`,
      );
    }

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    cities = app.get<Model<City>>(getModelToken(City.name));
    countries = app.get<Model<Country>>(getModelToken(Country.name));
    uploads = app.get(UploadsService);

    await countries.create([
      { _id: COUNTRY_A_ID, name: 'HTL-01 Test Country A', currency: 'XTS' },
      { _id: COUNTRY_B_ID, name: 'HTL-01 Test Country B', currency: 'XTS' },
    ]);
    await cities.create([
      { _id: CITY_A_ID, name: 'HTL-01 Test City A', countryCode: COUNTRY_A_ID },
      { _id: CITY_B_ID, name: 'HTL-01 Test City B', countryCode: COUNTRY_B_ID },
    ]);

    admin = await createAccount(Role.Admin);
    assignedHotelId = await createHotel(admin);
    otherHotelId = await createHotel(admin, CITY_A_ID, `Other hotel ${RUN}`);
    user = await createAccount(Role.User);
    airlineModerator = await createAccount(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: new MongooseTypes.ObjectId(),
    });
    assignedModerator = await createAccount(Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: new MongooseTypes.ObjectId(assignedHotelId),
    });
    otherHotelModerator = await createAccount(Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: new MongooseTypes.ObjectId(otherHotelId),
    });
  });

  afterAll(async () => {
    try {
      for (const filename of await readdir(uploads.directory)) {
        await uploads.deleteImage(filename);
      }
      for (const id of createdHotelIds) {
        await hotels.findByIdAndDelete(id).exec();
      }
      for (const id of createdUserIds) {
        await deleteSessionsOf(app, id);
        await users.findByIdAndDelete(id).exec();
      }
      await cities.findByIdAndDelete(CITY_A_ID).exec();
      await cities.findByIdAndDelete(CITY_B_ID).exec();
      await countries.findByIdAndDelete(COUNTRY_A_ID).exec();
      await countries.findByIdAndDelete(COUNTRY_B_ID).exec();
      if (existsSync(uploads.directory)) {
        await rmdir(uploads.directory);
      }
    } finally {
      await app.close();
    }
  });

  it('lets an admin create a hotel and copies the country from its city', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', admin.cookie)
      .send(validBody(CITY_A_ID, `Created hotel ${RUN}`))
      .expect(201);
    const id: unknown = response.body.id;
    if (typeof id !== 'string') {
      throw new Error('Hotel create response did not include a string id');
    }
    createdHotelIds.push(id);

    expect(response.body).toMatchObject({
      cityId: CITY_A_ID,
      countryCode: COUNTRY_A_ID,
      photos: [],
      active: true,
      ratingCount: 0,
      averageRating: 0,
    });
  });

  it('returns 400 when the requested city does not exist', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', admin.cookie)
      .send(validBody(`missing-${RUN}`))
      .expect(400);
  });

  it.each([
    ['active', false],
    ['ratingCount', 1],
    ['averageRating', 4.5],
    ['photos', []],
  ])('rejects client-controlled field %s', async (field, value) => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', admin.cookie)
      .send({ ...validBody(), [field]: value })
      .expect(400);
  });

  it('returns 403 when a registered user creates a hotel', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', user.cookie)
      .send(validBody())
      .expect(403);
  });

  it('returns 403 when an airline moderator creates a hotel', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .set('Cookie', airlineModerator.cookie)
      .send(validBody())
      .expect(403);
  });

  it('lets the assigned moderator edit the hotel and refreshes its country', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/hotels/${assignedHotelId}`)
      .set('Cookie', assignedModerator.cookie)
      .send({ name: `Updated hotel ${RUN}`, cityId: CITY_B_ID })
      .expect(200);

    expect(response.body).toMatchObject({
      id: assignedHotelId,
      cityId: CITY_B_ID,
      countryCode: COUNTRY_B_ID,
    });
    const stored = await hotels.findById(assignedHotelId).lean().orFail();
    expect(stored.countryCode).toBe(COUNTRY_B_ID);
  });

  it('returns 403 when a moderator edits another hotel', async () => {
    await request(app.getHttpServer())
      .patch(`/api/hotels/${assignedHotelId}`)
      .set('Cookie', otherHotelModerator.cookie)
      .send({ name: 'Not allowed' })
      .expect(403);
  });

  it('returns 403 when an admin edits a hotel', async () => {
    await request(app.getHttpServer())
      .patch(`/api/hotels/${assignedHotelId}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Not allowed' })
      .expect(403);
  });

  it('returns 404 when the moderator edits an unknown hotel', async () => {
    await request(app.getHttpServer())
      .patch(`/api/hotels/${new MongooseTypes.ObjectId().toString()}`)
      .set('Cookie', assignedModerator.cookie)
      .send({ name: 'Not found' })
      .expect(404);
  });

  it('uploads a photo, returns it, then removes the hotel reference and file', async () => {
    const uploaded = await request(app.getHttpServer())
      .post(`/api/hotels/${assignedHotelId}/photos`)
      .set('Cookie', assignedModerator.cookie)
      .attach('images', PNG, 'hotel.png')
      .expect(200);
    const photo = uploaded.body.photos[0] as
      { filename: string; url: string } | undefined;

    expect(photo).toEqual({
      filename: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
      ),
      url: expect.stringMatching(/^\/api\/uploads\/.+\.png$/),
    });
    if (!photo) {
      throw new Error('Upload response did not contain a photo');
    }
    const photoPath = join(uploads.directory, photo.filename);
    expect(existsSync(photoPath)).toBe(true);

    const removed = await request(app.getHttpServer())
      .delete(`/api/hotels/${assignedHotelId}/photos/${photo.filename}`)
      .set('Cookie', assignedModerator.cookie)
      .expect(200);

    expect(removed.body.photos).toEqual([]);
    expect(existsSync(photoPath)).toBe(false);
    const stored = await hotels.findById(assignedHotelId).lean().orFail();
    expect(stored.photos).toEqual([]);
  });

  it('refuses the sixth hotel photo', async () => {
    let upload = request(app.getHttpServer())
      .post(`/api/hotels/${assignedHotelId}/photos`)
      .set('Cookie', assignedModerator.cookie);
    for (let index = 0; index < 5; index += 1) {
      upload = upload.attach('images', PNG, `hotel-${index}.png`);
    }
    const uploaded = await upload.expect(200);
    expect(uploaded.body.photos).toHaveLength(5);

    await request(app.getHttpServer())
      .post(`/api/hotels/${assignedHotelId}/photos`)
      .set('Cookie', assignedModerator.cookie)
      .attach('images', PNG, 'sixth.png')
      .expect(400);
    const stored = await hotels.findById(assignedHotelId).lean().orFail();
    expect(stored.photos).toHaveLength(5);
  });

  it('returns 404 when removing a photo not attached to the hotel', async () => {
    await request(app.getHttpServer())
      .delete(`/api/hotels/${assignedHotelId}/photos/${randomUUID()}.jpg`)
      .set('Cookie', assignedModerator.cookie)
      .expect(404);
  });

  it('returns 401 when the request has no login cookie', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .send(validBody())
      .expect(401);
  });
});
