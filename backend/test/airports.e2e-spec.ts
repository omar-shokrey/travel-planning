import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Airport } from './../src/reference/models/airport.schema';
import { City } from './../src/reference/models/city.schema';
import { Country } from './../src/reference/models/country.schema';

/** The name every record of these tests carries, so cleanup never touches real data. */
const TEST_NAME = 'Airports e2e test';
const TEST_CITY = `flt02-e2e-${randomUUID()}`;
const letter = (): string => String.fromCharCode(65 + randomInt(26));

interface AirportBody {
  id: string;
  name: string;
  cityId: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  timeZone: string;
}

/**
 * FLT-02. The test database may hold no reference data (CI starts empty), so
 * the tests add one country, one city and two airports with codes no real
 * record uses, and delete them one by one at the end.
 */
describe('Airport list (e2e, FLT-02)', () => {
  let app: NestExpressApplication;
  let airports: Model<Airport>;
  let cities: Model<City>;
  let countries: Model<Country>;
  let testCountry: string;
  const testAirports: string[] = [];

  const http = () => request(app.getHttpServer());

  /** Every airport the API lists, read page by page. */
  const listAll = async (): Promise<AirportBody[]> => {
    const all: AirportBody[] = [];
    for (let page = 1; ; page++) {
      const response = await http()
        .get(`/api/airports?page=${page}&limit=50`)
        .expect(200);
      all.push(...(response.body.items as AirportBody[]));
      if (page >= response.body.meta.totalPages) return all;
    }
  };

  /** A code made of two or three letters that no record in the collection uses. */
  const unusedCode = async (
    exists: (code: string) => Promise<unknown>,
    length: number,
  ): Promise<string> => {
    for (;;) {
      const code = `Q${Array.from({ length: length - 1 }, letter).join('')}`;
      if (!(await exists(code)) && !testAirports.includes(code)) {
        return code;
      }
    }
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    airports = app.get<Model<Airport>>(getModelToken(Airport.name));
    cities = app.get<Model<City>>(getModelToken(City.name));
    countries = app.get<Model<Country>>(getModelToken(Country.name));

    testCountry = await unusedCode(
      (code) => countries.exists({ _id: code }),
      2,
    );
    await countries.create({
      _id: testCountry,
      name: TEST_NAME,
      currency: 'USD',
    });
    await cities.create({
      _id: TEST_CITY,
      name: TEST_NAME,
      countryCode: testCountry,
    });
    for (const timeZone of ['Africa/Cairo', 'Asia/Tokyo']) {
      const code = await unusedCode(
        (candidate) => airports.exists({ _id: candidate }),
        3,
      );
      testAirports.push(code);
      await airports.create({
        _id: code,
        name: `${TEST_NAME} ${code}`,
        cityId: TEST_CITY,
        countryCode: testCountry,
        timeZone,
      });
    }
  });

  afterAll(async () => {
    for (const code of testAirports) {
      await airports.deleteOne({ _id: code, cityId: TEST_CITY });
    }
    await cities.deleteOne({ _id: TEST_CITY, name: TEST_NAME });
    await countries.deleteOne({ _id: testCountry, name: TEST_NAME });
    await app.close();
  });

  it('is open to guests: no login cookie is needed', async () => {
    const response = await http().get('/api/airports').expect(200);

    expect(response.body).toEqual({
      items: expect.any(Array),
      meta: expect.objectContaining({ page: 1, limit: 10 }),
    });
  });

  it('lists every airport with its IATA code, name, city, country and time zone', async () => {
    const listed = await listAll();

    for (const [index, code] of testAirports.entries()) {
      expect(listed).toContainEqual({
        id: code,
        name: `${TEST_NAME} ${code}`,
        cityId: TEST_CITY,
        cityName: TEST_NAME,
        countryCode: testCountry,
        countryName: TEST_NAME,
        timeZone: ['Africa/Cairo', 'Asia/Tokyo'][index],
      });
    }
    expect(listed).toHaveLength(await airports.countDocuments());
  });

  it('sorts the airports by IATA code', async () => {
    const codes = (await listAll()).map((airport) => airport.id);

    expect(codes).toEqual([...codes].sort());
  });

  it('pages the list', async () => {
    const total = await airports.countDocuments();

    const response = await http()
      .get('/api/airports?page=2&limit=1')
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.meta).toEqual({
      page: 2,
      limit: 1,
      total,
      totalPages: total,
    });
  });

  it.each([
    ['a page size above 50', 'limit=51', 'limit'],
    ['a page below 1', 'page=0', 'page'],
    ['an unknown parameter', 'sort=name', 'sort'],
  ])('rejects %s with 400', async (_label, query, field) => {
    const response = await http().get(`/api/airports?${query}`).expect(400);

    expect(response.body.errors).toEqual([
      { field, messages: expect.any(Array) },
    ]);
  });

  it.each(['post', 'patch', 'put', 'delete'] as const)(
    'is read-only: %s has no route',
    async (method) => {
      await http()[method]('/api/airports').expect(404);
      expect(await airports.countDocuments({ cityId: TEST_CITY })).toBe(2);
    },
  );

  it('documents the route in Swagger as public, with the requirement ID', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const list = response.body.paths['/api/airports'].get as {
      tags: string[];
      description: string;
      security?: unknown;
      responses: Record<string, unknown>;
    };

    expect(list.tags).toEqual(['Airports']);
    expect(list.description).toMatch(/^FLT-02\. /);
    expect(list.security).toBeUndefined();
    expect(Object.keys(list.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
    expect(
      Object.keys(
        response.body.components.schemas.AirportResponseDto.properties,
      ),
    ).toEqual([
      'id',
      'name',
      'cityId',
      'cityName',
      'countryCode',
      'countryName',
      'timeZone',
    ]);
  });
});
