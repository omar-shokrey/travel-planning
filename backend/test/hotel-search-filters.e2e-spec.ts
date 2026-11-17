import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { Room } from './../src/hotels/models/room.schema';

const RUN = randomUUID().slice(0, 8);
// A city of its own, so no other record can change the results.
const CITY = `htl12-${RUN}`;

/** A date `days` after today (UTC), so the test never falls in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

const BASE = {
  cityId: CITY,
  checkIn: day(10),
  checkOut: day(12),
  guests: '2',
};

describe('Hotel price and rating filters (e2e, HTL-12)', () => {
  let app: NestExpressApplication;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];

  const search = (query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/api/hotels/search')
      .query({ ...BASE, ...query });

  const name = (label: string) => `HTL12 ${label} ${RUN}`;

  const names = (body: { items: { name: string }[] }) =>
    body.items.map((hotel) => hotel.name);

  /** A hotel with its rating and free rooms at the given prices. */
  const createHotel = async (
    label: string,
    averageRating: number,
    ratingCount: number,
    prices: number[],
  ) => {
    const hotel = await hotels.create({
      name: name(label),
      addressLine: '12 Nile Street',
      cityId: CITY,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-12 e2e test.',
      photos: [],
      starClass: 3,
      amenities: [],
      averageRating,
      ratingCount,
    });
    createdHotelIds.push(hotel._id.toString());
    for (const [index, pricePerNight] of prices.entries()) {
      const room = await rooms.create({
        hotelId: hotel._id,
        number: `${index + 1}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        pricePerNight,
        availability: [{ from: day(0), to: day(60) }],
      });
      createdRoomIds.push(room._id.toString());
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

    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = app.get<Model<Room>>(getModelToken(Room.name));

    // The price of a hotel is the price of its cheapest free room.
    await createHotel('A', 4, 10, [12000, 30000]);
    await createHotel('B', 4.5, 2, [9000]);
    await createHotel('C', 0, 0, [15000]);
    await createHotel('D', 3, 5, [9000]);
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await rooms.findByIdAndDelete(new Types.ObjectId(id));
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('keeps the name order when nothing is filtered or sorted', async () => {
    const response = await search({});

    expect(response.status).toBe(200);
    expect(names(response.body)).toEqual([
      name('A'),
      name('B'),
      name('C'),
      name('D'),
    ]);
  });

  it('filters on the price of the cheapest free room, both limits included', async () => {
    const response = await search({ minPrice: '9000', maxPrice: '12000' });

    expect(names(response.body)).toEqual([name('A'), name('B'), name('D')]);
    expect(response.body.meta.total).toBe(3);
    expect(
      response.body.items.map(
        (hotel: { cheapestPricePerNight: number }) =>
          hotel.cheapestPricePerNight,
      ),
    ).toEqual([12000, 9000, 9000]);
  });

  it('applies a single price limit', async () => {
    const cheap = await search({ maxPrice: '9000' });
    const dear = await search({ minPrice: '12001' });

    expect(names(cheap.body)).toEqual([name('B'), name('D')]);
    expect(names(dear.body)).toEqual([name('C')]);
  });

  it('leaves out lower-rated and unrated hotels with a minimum rating', async () => {
    const response = await search({ minRating: '4' });

    expect(names(response.body)).toEqual([name('A'), name('B')]);
  });

  it('leaves out an unrated hotel even with the lowest minimum rating', async () => {
    const response = await search({ minRating: '1' });

    expect(names(response.body)).not.toContain(name('C'));
    expect(names(response.body)).toHaveLength(3);
  });

  it('sorts by price, cheapest first, equal prices in name order', async () => {
    const response = await search({ sort: 'price' });

    expect(names(response.body)).toEqual([
      name('B'),
      name('D'),
      name('A'),
      name('C'),
    ]);
  });

  it('sorts by price, most expensive first', async () => {
    const response = await search({ sort: 'price', order: 'desc' });

    expect(names(response.body)).toEqual([
      name('C'),
      name('A'),
      name('B'),
      name('D'),
    ]);
  });

  it('sorts by rating, best first', async () => {
    const response = await search({ sort: 'rating' });

    expect(names(response.body)).toEqual([
      name('B'),
      name('A'),
      name('D'),
      name('C'),
    ]);
  });

  it('combines filters, sort and pages', async () => {
    const response = await search({
      minRating: '3',
      maxPrice: '12000',
      sort: 'rating',
      order: 'asc',
      page: '2',
      limit: '2',
    });

    expect(names(response.body)).toEqual([name('B')]);
    expect(response.body.meta).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it.each([
    ['a maximum below the minimum', { minPrice: '9000', maxPrice: '8000' }],
    ['a negative price', { minPrice: '-5' }],
    ['a rating of 0', { minRating: '0' }],
    ['a rating of 6', { minRating: '6' }],
    ['an unknown sort', { sort: 'stars' }],
    ['an unknown order', { order: 'random' }],
  ])('answers 400 for %s', async (_, query) => {
    const response = await search(query);
    expect(response.status).toBe(400);
  });
});
