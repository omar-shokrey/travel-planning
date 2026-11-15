import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { Model } from 'mongoose';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  Airport,
  type AirportDocument,
} from './../src/reference/models/airport.schema';
import { City, type CityDocument } from './../src/reference/models/city.schema';
import {
  Country,
  type CountryDocument,
} from './../src/reference/models/country.schema';

describe('Airports (e2e)', () => {
  let app: NestExpressApplication;
  let airportModel: Model<AirportDocument>;
  let cityModel: Model<CityDocument>;
  let countryModel: Model<CountryDocument>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    airportModel = moduleFixture.get<Model<AirportDocument>>(
      getModelToken(Airport.name),
    );
    cityModel = moduleFixture.get<Model<CityDocument>>(
      getModelToken(City.name),
    );
    countryModel = moduleFixture.get<Model<CountryDocument>>(
      getModelToken(Country.name),
    );
  });

  beforeEach(async () => {
    await airportModel.deleteMany({});
    await cityModel.deleteMany({});
    await countryModel.deleteMany({});

    await countryModel.create({
      _id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });

    await cityModel.create({
      _id: 'cairo',
      name: 'Cairo',
      countryCode: 'EG',
    });

    await airportModel.create({
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
  });

  afterAll(async () => {
    await airportModel.deleteMany({});
    await cityModel.deleteMany({});
    await countryModel.deleteMany({});
    await app.close();
  });

  it('returns the paginated airport list with city and country names', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          code: 'CAI',
          name: 'Cairo International Airport',
          city: 'Cairo',
          country: 'Egypt',
          timeZone: 'Africa/Cairo',
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('supports pagination', async () => {
    await cityModel.create([
      {
        _id: 'alexandria',
        name: 'Alexandria',
        countryCode: 'EG',
      },
      {
        _id: 'luxor',
        name: 'Luxor',
        countryCode: 'EG',
      },
    ]);

    await airportModel.create([
      {
        _id: 'ALY',
        name: 'Borg El Arab Airport',
        cityId: 'alexandria',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: 'LXR',
        name: 'Luxor International Airport',
        cityId: 'luxor',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/airports?page=2&limit=2')
      .expect(200);

    expect(response.body.meta).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual({
      code: 'LXR',
      name: 'Luxor International Airport',
      city: 'Luxor',
      country: 'Egypt',
      timeZone: 'Africa/Cairo',
    });
  });

  it('rejects invalid pagination parameters', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/airports?page=0&limit=100')
      .expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        {
          field: 'page',
          messages: [expect.stringContaining('page')],
        },
        {
          field: 'limit',
          messages: [expect.stringContaining('limit')],
        },
      ]),
    );
  });

  it('is publicly accessible without authentication', async () => {
    await request(app.getHttpServer()).get('/api/airports').expect(200);
  });
});
