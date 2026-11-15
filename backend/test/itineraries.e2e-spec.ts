import { TEST_ACCESS_SECRET } from './support/auth-env';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { Country } from './../src/reference/models/country.schema';
import { User } from './../src/users/models/user.schema';

/**
 * A country code that is not in countries.csv (codes starting with X are
 * never given to a real country). The test database may have no reference
 * data at all, so the tests add this one country and remove it at the end.
 */
const TEST_COUNTRY = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
const TEST_COUNTRY_NAME = 'Itineraries e2e test country';

const validBody = () => ({
  title: 'Ten days in Egypt',
  countries: [TEST_COUNTRY],
  startDate: '2026-12-20',
});

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Itineraries (e2e, ITN-01, ITN-03)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let countries: Model<Country>;
  let itineraries: Model<Itinerary>;
  const jwt = new JwtService();
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdItineraryIds: string[] = [];

  let owner: { id: string; cookie: string };
  let otherUser: { id: string; cookie: string };

  /** A user in the database and the cookie a browser would send after login. */
  const createUser = async (): Promise<{ id: string; cookie: string }> => {
    const user = await users.create({
      name: 'Itinerary Test',
      email: `itn01-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    const token = await jwt.signAsync(
      { sub: id },
      { secret: TEST_ACCESS_SECRET, expiresIn: 300 },
    );
    return { id, cookie: `${ACCESS_TOKEN_COOKIE}=${token}` };
  };

  const http = () => request(app.getHttpServer());

  const create = async (cookie: string, body: Record<string, unknown>) => {
    const response = await http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send(body);
    if (response.status === 201) {
      createdItineraryIds.push(response.body.id);
    }
    return response;
  };

  /** An itinerary of the owner, for the tests that edit or delete one. */
  const existing = async (): Promise<string> => {
    const response = await create(owner.cookie, validBody());
    expect(response.status).toBe(201);
    return response.body.id as string;
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
    countries = app.get<Model<Country>>(getModelToken(Country.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    await countries.updateOne(
      { _id: TEST_COUNTRY },
      { $setOnInsert: { name: TEST_COUNTRY_NAME, currency: 'USD' } },
      { upsert: true },
    );
    owner = await createUser();
    otherUser = await createUser();
  });

  afterAll(async () => {
    for (const id of createdItineraryIds) {
      await itineraries.deleteOne({ _id: id });
    }
    for (const id of createdUserIds) {
      await users.deleteOne({ _id: id });
    }
    await countries.deleteOne({ _id: TEST_COUNTRY, name: TEST_COUNTRY_NAME });
    await app.close();
  });

  describe('without a login', () => {
    const id = new Types.ObjectId().toString();

    it.each([
      ['post', '/api/itineraries'],
      ['get', '/api/itineraries'],
      ['get', `/api/itineraries/${id}`],
      ['patch', `/api/itineraries/${id}`],
      ['delete', `/api/itineraries/${id}`],
    ] as const)('refuses %s %s', async (method, path) => {
      const response = await http()[method](path).send(validBody());

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        path,
      });
    });
  });

  describe('POST /api/itineraries', () => {
    it('creates a private itinerary that belongs to the logged-in user', async () => {
      const response = await create(owner.cookie, validBody());

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        ownerId: owner.id,
        title: 'Ten days in Egypt',
        countries: [TEST_COUNTRY],
        startDate: '2026-12-20',
        visibility: 'private',
        dayCount: 0,
      });

      const stored = await itineraries.findById(response.body.id).lean();
      expect(stored?.ownerId.toString()).toBe(owner.id);
      expect(stored?.startDate).toBe('2026-12-20');
    });

    it('trims the title', async () => {
      const response = await create(owner.cookie, {
        ...validBody(),
        title: '  Nile cruise  ',
      });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe('Nile cruise');
    });

    it('rejects a body with missing fields, one message list per field', async () => {
      const response = await create(owner.cookie, {});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(
        (response.body.errors as { field: string }[])
          .map((error) => error.field)
          .sort(),
      ).toEqual(['countries', 'startDate', 'title']);
    });

    it.each([
      ['a title above 100 characters', { title: 'x'.repeat(101) }, 'title'],
      ['no country', { countries: [] }, 'countries'],
      [
        'a start date that does not exist',
        { startDate: '2026-02-30' },
        'startDate',
      ],
    ])('rejects %s', async (_label, change, field) => {
      const response = await create(owner.cookie, {
        ...validBody(),
        ...change,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: expect.any(Array) },
      ]);
    });

    it('does not let the client set the owner or the visibility', async () => {
      const response = await create(owner.cookie, {
        ...validBody(),
        ownerId: otherUser.id,
        visibility: 'public',
      });

      expect(response.status).toBe(400);
      expect(
        (response.body.errors as { field: string }[])
          .map((error) => error.field)
          .sort(),
      ).toEqual(['ownerId', 'visibility']);
    });

    it('rejects a country that is not in the country list', async () => {
      const response = await create(owner.cookie, {
        ...validBody(),
        countries: [TEST_COUNTRY, 'QQ'],
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Unknown country code: QQ');
    });
  });

  describe('GET /api/itineraries', () => {
    it('lists only my itineraries, most recently updated first', async () => {
      const user = await createUser();
      const titles = ['First', 'Second', 'Third'];
      const ids: string[] = [];
      for (const title of titles) {
        const response = await create(user.cookie, { ...validBody(), title });
        ids.push(response.body.id as string);
      }
      // Editing the first one makes it the most recently updated.
      await http()
        .patch(`/api/itineraries/${ids[0]}`)
        .set('Cookie', user.cookie)
        .send({ title: 'First, edited' })
        .expect(200);
      await existing();

      const response = await http()
        .get('/api/itineraries')
        .set('Cookie', user.cookie)
        .expect(200);

      expect(
        (response.body.items as { title: string }[]).map((item) => item.title),
      ).toEqual(['First, edited', 'Third', 'Second']);
      expect(response.body.items[0]).toEqual({
        id: ids[0],
        ownerId: user.id,
        title: 'First, edited',
        countries: [TEST_COUNTRY],
        startDate: '2026-12-20',
        visibility: 'private',
        dayCount: 0,
      });
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('returns an empty list to a user with no itineraries', async () => {
      const user = await createUser();

      const response = await http()
        .get('/api/itineraries')
        .set('Cookie', user.cookie)
        .expect(200);

      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('returns the requested page', async () => {
      const user = await createUser();
      for (const title of ['A', 'B', 'C']) {
        await create(user.cookie, { ...validBody(), title });
      }

      const response = await http()
        .get('/api/itineraries?page=2&limit=2')
        .set('Cookie', user.cookie)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].title).toBe('A');
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('rejects a page size above 50', async () => {
      const response = await http()
        .get('/api/itineraries?limit=51')
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'limit', messages: expect.any(Array) },
      ]);
    });
  });

  describe('GET /api/itineraries/:id', () => {
    it('returns my itinerary with its days', async () => {
      const id = await existing();

      const response = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(response.body).toEqual({
        id,
        ownerId: owner.id,
        title: 'Ten days in Egypt',
        countries: [TEST_COUNTRY],
        startDate: '2026-12-20',
        visibility: 'private',
        dayCount: 0,
        days: [],
      });
    });

    it('answers 403 to another user: a private itinerary is for its owner only', async () => {
      const id = await existing();

      const response = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', otherUser.cookie);

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('Ten days in Egypt');
    });

    it('answers 404 for an id that has no itinerary and 400 for a bad id', async () => {
      const missing = await http()
        .get(`/api/itineraries/${new Types.ObjectId().toString()}`)
        .set('Cookie', owner.cookie);
      const badId = await http()
        .get('/api/itineraries/not-an-id')
        .set('Cookie', owner.cookie);

      expect(missing.status).toBe(404);
      expect(badId.status).toBe(400);
    });
  });

  describe('PATCH /api/itineraries/:id', () => {
    it('changes only the fields that are sent', async () => {
      const id = await existing();

      const response = await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Renamed', startDate: '2027-01-05' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id,
        title: 'Renamed',
        countries: [TEST_COUNTRY],
        startDate: '2027-01-05',
        visibility: 'private',
      });
    });

    it('rejects an invalid field and an unknown country', async () => {
      const id = await existing();
      const patch = (body: Record<string, unknown>) =>
        http()
          .patch(`/api/itineraries/${id}`)
          .set('Cookie', owner.cookie)
          .send(body);

      expect((await patch({ title: '' })).status).toBe(400);
      expect((await patch({ visibility: 'public' })).status).toBe(400);
      const unknown = await patch({ countries: ['QQ'] });
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toBe('Unknown country code: QQ');
    });

    it('answers 403 to another user and changes nothing', async () => {
      const id = await existing();

      const response = await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', otherUser.cookie)
        .send({ title: 'Mine now' });

      expect(response.status).toBe(403);
      expect((await itineraries.findById(id).lean())?.title).toBe(
        'Ten days in Egypt',
      );
    });

    it('answers 404 for an id that has no itinerary and 400 for a bad id', async () => {
      const missing = await http()
        .patch(`/api/itineraries/${new Types.ObjectId().toString()}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'x' });
      const badId = await http()
        .patch('/api/itineraries/not-an-id')
        .set('Cookie', owner.cookie)
        .send({ title: 'x' });

      expect(missing.status).toBe(404);
      expect(badId.status).toBe(400);
    });
  });

  describe('DELETE /api/itineraries/:id', () => {
    it('deletes the itinerary of the logged-in user', async () => {
      const id = await existing();

      const response = await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(await itineraries.findById(id).lean()).toBeNull();
    });

    it('answers 404 when the itinerary was already deleted', async () => {
      const id = await existing();
      const remove = () =>
        http().delete(`/api/itineraries/${id}`).set('Cookie', owner.cookie);

      expect((await remove()).status).toBe(204);
      expect((await remove()).status).toBe(404);
    });

    it('answers 403 to another user and deletes nothing', async () => {
      const id = await existing();

      const response = await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', otherUser.cookie);

      expect(response.status).toBe(403);
      expect(await itineraries.findById(id).lean()).not.toBeNull();
    });
  });

  it('documents the ITN-03 routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const list = paths['/api/itineraries'].get;
    const detail = paths['/api/itineraries/{id}'].get;

    for (const operation of [list, detail]) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-03\. /);
    }
    expect(Object.keys(list.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    );
    expect(Object.keys(detail.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
    expect(Object.keys(response.body.components.schemas)).toEqual(
      expect.arrayContaining([
        'ItineraryResponseDto',
        'ItineraryDetailResponseDto',
        'ItineraryDayResponseDto',
        'PaginationMeta',
      ]),
    );
    // The example of the detail response must not contradict itself.
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, { example?: unknown }> }
    >;
    expect(schemas.ItineraryDetailResponseDto.properties.dayCount.example).toBe(
      1,
    );
    expect(schemas.ItineraryResponseDto.properties.dayCount.example).toBe(0);
  });

  it('documents the ITN-01 routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const responsesOf = (operation: SwaggerOperation) =>
      Object.keys(operation.responses);
    const post = paths['/api/itineraries'].post;
    const patch = paths['/api/itineraries/{id}'].patch;
    const remove = paths['/api/itineraries/{id}'].delete;

    for (const operation of [post, patch, remove]) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-01\. /);
    }
    expect(responsesOf(post)).toEqual(
      expect.arrayContaining(['201', '400', '401']),
    );
    expect(responsesOf(patch)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
    expect(responsesOf(remove)).toEqual(
      expect.arrayContaining(['204', '400', '401', '403', '404']),
    );
  });
});
