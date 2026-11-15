import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Hotel } from './../src/hotels/models/hotel.schema';

describe('GET /api/hotels/:id (e2e, HTL-02)', () => {
  let app: NestExpressApplication;
  let hotels: Model<Hotel>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];

  const createHotel = async (fields: Partial<Hotel> = {}): Promise<string> => {
    const hotel = await hotels.create({
      name: 'HTL-02 Test Hotel',
      addressLine: '12 Nile Street',
      cityId: 'city_001',
      countryCode: 'EG',
      description: 'A quiet hotel close to the city centre.',
      photos: ['c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg'],
      starClass: 4,
      amenities: ['wifi', 'pool'],
      ...fields,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    return id;
  };

  const getHotel = (id: string) =>
    request(app.getHttpServer()).get(`/api/hotels/${id}`);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
  });

  afterAll(async () => {
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('shows the hotel page to a guest, without login', async () => {
    const id = await createHotel({ ratingCount: 12, averageRating: 4.5 });

    const response = await getHotel(id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id,
      name: 'HTL-02 Test Hotel',
      addressLine: '12 Nile Street',
      cityId: 'city_001',
      countryCode: 'EG',
      description: 'A quiet hotel close to the city centre.',
      photos: [
        {
          filename: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
          url: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
        },
      ],
      starClass: 4,
      amenities: ['wifi', 'pool'],
      active: true,
      ratingCount: 12,
      averageRating: 4.5,
      createdAt: expect.stringMatching(/Z$/),
      updatedAt: expect.stringMatching(/Z$/),
    });
  });

  it('shows a rating of 0 for a hotel that has no ratings yet', async () => {
    const id = await createHotel();

    const response = await getHotel(id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ratingCount: 0, averageRating: 0 });
  });

  it('answers 404 for a deactivated hotel', async () => {
    const id = await createHotel({ active: false });

    const response = await getHotel(id);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: 'Hotel not found' });
  });

  it('answers 404 for a hotel that does not exist', async () => {
    const response = await getHotel(new Types.ObjectId().toString());

    expect(response.status).toBe(404);
  });

  it('answers 400 for an id that is not an id', async () => {
    const response = await getHotel('not-an-id');

    expect(response.status).toBe(400);
  });

  it('is listed in Swagger under the hotels tag', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    const paths = (
      response.body as { paths: Record<string, { get?: { tags: string[] } }> }
    ).paths;
    expect(paths['/api/hotels/{id}']?.get?.tags).toEqual(['hotels']);
  });
});
