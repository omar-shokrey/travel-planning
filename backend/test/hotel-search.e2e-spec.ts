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
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';

const RUN = randomUUID().slice(0, 8);
// A city of its own, so no other record can change the results.
const CITY = `htl11-${RUN}`;
// A country code no seeded country uses.
const COUNTRY = 'QZ';

/** A date `days` after today (UTC), so the test never falls in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

const range = (from: string, to: string) => ({ from, to });

const STAY = { checkIn: day(10), checkOut: day(13) };

describe('Hotel search (e2e, HTL-11)', () => {
  let app: NestExpressApplication;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const hotelIds = new Map<string, string>();

  const search = (query: Record<string, string>) =>
    request(app.getHttpServer()).get('/api/hotels/search').query(query);

  const names = (body: { items: { name: string }[] }) =>
    body.items.map((hotel) => hotel.name);

  const name = (label: string) => `HTL11 ${label} ${RUN}`;

  const createHotel = async (label: string, active = true) => {
    const hotel = await hotels.create({
      name: name(label),
      addressLine: '12 Nile Street',
      cityId: CITY,
      countryCode: COUNTRY,
      description: 'A hotel created by the HTL-11 e2e test.',
      photos: [],
      starClass: 3,
      amenities: [],
      active,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    hotelIds.set(label, id);
    return id;
  };

  const createRoom = async (
    hotelId: string,
    number: string,
    maxOccupancy: number,
    pricePerNight: number,
  ) => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(hotelId),
      number,
      type: 'Double',
      beds: 2,
      maxOccupancy,
      pricePerNight,
      availability: [range(day(0), day(60))],
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    return id;
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
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    await roomNights.init();

    // A: two free rooms (2 and 3 guests), the cheaper one at 9000.
    const a = await createHotel('A');
    await createRoom(a, '101', 2, 15000);
    await createRoom(a, '102', 3, 9000);
    // B: its only room is booked during the stay.
    const b = await createHotel('B');
    const bRoom = await createRoom(b, '201', 2, 8000);
    await roomNights.create({
      roomId: new Types.ObjectId(bRoom),
      hotelId: new Types.ObjectId(b),
      date: day(11),
      state: RoomNightState.Booked,
      bookingId: new Types.ObjectId(),
    });
    // C: one free room for 4 guests.
    const c = await createHotel('C');
    await createRoom(c, '301', 4, 12000);
    // D: free rooms, but the hotel is deactivated (ACC-15).
    const d = await createHotel('D', false);
    await createRoom(d, '401', 4, 5000);
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await roomNights.deleteMany({ roomId: new Types.ObjectId(id) });
      await rooms.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('lists, without login, the active hotels of the city that can host the guests', async () => {
    const response = await search({ ...STAY, cityId: CITY, guests: '2' });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      {
        id: hotelIds.get('A'),
        name: name('A'),
        addressLine: '12 Nile Street',
        cityId: CITY,
        countryCode: COUNTRY,
        starClass: 3,
        amenities: [],
        photos: [],
        averageRating: 0,
        ratingCount: 0,
        freeRooms: 2,
        cheapestPricePerNight: 9000,
        currency: 'USD',
      },
      expect.objectContaining({
        id: hotelIds.get('C'),
        freeRooms: 1,
        cheapestPricePerNight: 12000,
      }),
    ]);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('needs one room that holds all the guests when one room is asked', async () => {
    const response = await search({ ...STAY, cityId: CITY, guests: '4' });

    expect(response.status).toBe(200);
    expect(names(response.body)).toEqual([name('C')]);
  });

  it('adds up the occupancy of several rooms', async () => {
    const fits = await search({
      ...STAY,
      cityId: CITY,
      guests: '5',
      rooms: '2',
    });
    const tooMany = await search({
      ...STAY,
      cityId: CITY,
      guests: '6',
      rooms: '2',
    });

    expect(names(fits.body)).toEqual([name('A')]);
    expect(tooMany.body.items).toEqual([]);
    expect(tooMany.body.meta.total).toBe(0);
  });

  it('finds the hotel again once the stay no longer touches the booked night', async () => {
    const response = await search({
      checkIn: day(12),
      checkOut: day(14),
      cityId: CITY,
      guests: '2',
    });

    expect(names(response.body)).toEqual([name('A'), name('B'), name('C')]);
  });

  it('searches a country, in any letter case', async () => {
    const response = await search({
      ...STAY,
      countryCode: COUNTRY.toLowerCase(),
      guests: '2',
      limit: '50',
    });

    expect(response.status).toBe(200);
    const ours = names(response.body).filter((found) => found.endsWith(RUN));
    expect(ours).toEqual([name('A'), name('C')]);
  });

  it('pages through the results', async () => {
    const response = await search({
      ...STAY,
      cityId: CITY,
      guests: '2',
      page: '2',
      limit: '1',
    });

    expect(names(response.body)).toEqual([name('C')]);
    expect(response.body.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('is not read as a hotel id by GET /api/hotels/:id', async () => {
    const response = await search({});

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'Send exactly one of cityId or countryCode',
    );
  });

  it.each([
    ['both destinations', { cityId: CITY, countryCode: COUNTRY, guests: '2' }],
    ['no guests', { cityId: CITY }],
    ['0 rooms', { cityId: CITY, guests: '2', rooms: '0' }],
    ['a check-in in the past', { cityId: CITY, guests: '2', checkIn: day(-1) }],
    [
      'check-out before check-in',
      { cityId: CITY, guests: '2', checkOut: day(9) },
    ],
    [
      'a stay of 367 nights',
      { cityId: CITY, guests: '2', checkIn: day(1), checkOut: day(368) },
    ],
  ])('answers 400 for %s', async (_, query) => {
    const response = await search({ ...STAY, ...query } as Record<
      string,
      string
    >);
    expect(response.status).toBe(400);
  });

  it('documents the route in Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');
    const paths = response.body.paths as Record<
      string,
      { get?: { tags?: string[] } }
    >;
    expect(paths['/api/hotels/search']?.get?.tags).toEqual(['hotels']);
  });
});
