import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../../src/app.module';
import { configureApp, setupSwagger } from './../../src/app.setup';
import { Itinerary } from './../../src/itineraries/models/itinerary.schema';
import { City } from './../../src/reference/models/city.schema';
import { Country } from './../../src/reference/models/country.schema';
import { User } from './../../src/users/models/user.schema';
import { deleteSessionsOf } from './delete-sessions';
import { sessionCookieFor } from './session-cookie';

/** The name every reference record of these tests carries, so cleanup never touches real data. */
const TEST_NAME = 'Itineraries e2e fixture';

/** The currency of the test country, so it is a supported currency (ITN-10, ITN-16). */
export const FIXTURE_CURRENCY = 'USD';

export interface FixtureUser {
  id: string;
  name: string;
  cookie: string;
}

/** A day as the API returns it, with only the fields the tests read. */
export interface DayBody {
  id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  notes?: string;
}

/** An itinerary with its days, as the API returns it. */
export interface DetailBody {
  id: string;
  dayCount: number;
  days: DayBody[];
}

export interface ItineraryFixture {
  app: NestExpressApplication;
  itineraries: Model<Itinerary>;
  /** A test country with two test cities. Their ids are not used by real data. */
  country: string;
  cityA: string;
  cityB: string;
  http: () => ReturnType<typeof request>;
  createUser: () => Promise<FixtureUser>;
  /** A private itinerary of this user, starting on 2026-12-20, with one day per city given. */
  createItinerary: (
    user: FixtureUser,
    cities?: string[],
    title?: string,
  ) => Promise<DetailBody>;
  /** Removes every record the fixture and the tests made, one by one by id. */
  cleanup: () => Promise<void>;
}

/**
 * Shared setup for the itinerary end-to-end tests. The test database may hold
 * no reference data (CI starts empty), so it adds one country and two cities
 * with ids that no real record uses. Users get a live session (ACC-06).
 */
export async function createItineraryFixture(): Promise<ItineraryFixture> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app);
  setupSwagger(app);
  await app.init();

  const users = app.get<Model<User>>(getModelToken(User.name));
  const countries = app.get<Model<Country>>(getModelToken(Country.name));
  const cities = app.get<Model<City>>(getModelToken(City.name));
  const itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  // A two-letter code starting with X that no country uses. Test files run
  // at the same time, so a code taken in between is tried again.
  let country = '';
  for (;;) {
    const code = `X${String.fromCharCode(65 + randomInt(26))}`;
    try {
      await countries.create({
        _id: code,
        name: TEST_NAME,
        currency: FIXTURE_CURRENCY,
      });
      country = code;
      break;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  const cityA = `itn-fixture-${randomUUID()}`;
  const cityB = `itn-fixture-${randomUUID()}`;
  for (const cityId of [cityA, cityB]) {
    await cities.create({ _id: cityId, name: TEST_NAME, countryCode: country });
  }

  const createUser = async (): Promise<FixtureUser> => {
    const name = `Traveller ${randomUUID().slice(0, 8)}`;
    const user = await users.create({
      name,
      email: `itn-fixture-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    userIds.push(id);
    return { id, name, cookie: await sessionCookieFor(app, id) };
  };

  const createItinerary = async (
    user: FixtureUser,
    cityIds: string[] = [],
    title = 'Fixture itinerary',
  ): Promise<DetailBody> => {
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', user.cookie)
      .send({ title, countries: [country], startDate: '2026-12-20' })
      .expect(201);
    const id = created.body.id as string;
    let detail = { ...created.body, days: [] } as DetailBody;
    for (const cityId of cityIds) {
      const added = await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', user.cookie)
        .send({ cityId })
        .expect(201);
      detail = added.body as DetailBody;
    }
    return detail;
  };

  const cleanup = async (): Promise<void> => {
    for (const id of userIds) {
      // Every itinerary of a test user, including clones (ITN-21).
      for (const { _id } of await itineraries
        .find({ ownerId: id })
        .select('_id')
        .lean()) {
        await itineraries.deleteOne({ _id });
      }
      await deleteSessionsOf(app, id);
      await users.deleteOne({ _id: id });
    }
    for (const cityId of [cityA, cityB]) {
      await cities.deleteOne({ _id: cityId, name: TEST_NAME });
    }
    await countries.deleteOne({ _id: country, name: TEST_NAME });
    await app.close();
  };

  return {
    app,
    itineraries,
    country,
    cityA,
    cityB,
    http,
    createUser,
    createItinerary,
    cleanup,
  };
}
