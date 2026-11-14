import type { NestExpressApplication } from '@nestjs/platform-express';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  Airport,
  AirportDocument,
} from './../src/reference/models/airport.schema';
import { City, CityDocument } from './../src/reference/models/city.schema';
import {
  Country,
  CountryDocument,
} from './../src/reference/models/country.schema';

describe('Airports (e2e)', () => {
  let app: NestExpressApplication;
  let airportModel: Model<AirportDocument>;
  let cityModel: Model<CityDocument>;
  let countryModel: Model<CountryDocument>;

  const testId = randomUUID();
  const airportId = `T${testId.slice(0, 2).toUpperCase()}`;
  const cityId = `test-city-${testId}`;
  const countryCode = `T${testId.slice(0, 2).toUpperCase()}`;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    airportModel = app.get<Model<AirportDocument>>(getModelToken(Airport.name));
    cityModel = app.get<Model<CityDocument>>(getModelToken(City.name));
    countryModel = app.get<Model<CountryDocument>>(getModelToken(Country.name));

    await countryModel.create({
      _id: countryCode,
      name: `Test Country ${testId}`,
      currency: 'TST',
    });

    await cityModel.create({
      _id: cityId,
      name: `Test City ${testId}`,
      countryCode,
    });

    await airportModel.create({
      _id: airportId,
      name: `Test Airport ${testId}`,
      cityId,
      countryCode,
      timeZone: 'Africa/Cairo',
    });
  });

  afterAll(async () => {
    await airportModel.deleteOne({ _id: airportId }).exec();
    await cityModel.deleteOne({ _id: cityId }).exec();
    await countryModel.deleteOne({ _id: countryCode }).exec();

    await app.close();
  });

  it('returns a paginated public airport list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(200);

    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('meta');

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        {
          code: airportId,
          name: `Test Airport ${testId}`,
          city: `Test City ${testId}`,
          country: `Test Country ${testId}`,
          timeZone: 'Africa/Cairo',
        },
      ]),
    );

    const airport = response.body.items.find(
      (item: { code: string }) => item.code === airportId,
    );

    expect(Object.keys(airport).sort()).toEqual([
      'city',
      'code',
      'country',
      'name',
      'timeZone',
    ]);
  });

  it('rejects a limit greater than 50', async () => {
    await request(app.getHttpServer())
      .get('/api/airports?limit=100')
      .expect(400);
  });
});
