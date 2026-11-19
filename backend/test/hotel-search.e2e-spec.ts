import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { todayUtc } from './../src/hotels/room-dates';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);
/** A city id no real hotel uses, so the results are only this file's hotels. */
const CITY = `htl11-city-${RUN}`;
const OTHER_CITY = `htl11-other-${RUN}`;
/**
 * A country code for the country search. Other test files may use the same
 * code, so country tests look only for this file's hotels.
 */
const COUNTRY = `Q${String.fromCharCode(65 + randomInt(26))}`;

/** Dates far in the future, so "check-in in the past" never trips. */
const OPEN = { from: '2099-03-01', to: '2099-04-01' };
const STAY = { checkIn: '2099-03-10', checkOut: '2099-03-13' };

interface ResultBody {
  id: string;
  name: string;
  cityId: string;
  freeRooms: number;
  lowestPricePerNight: number;
  currency: string;
}
interface PageBody {
  items: ResultBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('Hotel search (e2e, HTL-11)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  let userId = '';
  let userCookie = '';

  const ids: Record<string, string> = {};

  const search = (query: Record<string, string | number>, cookie?: string) => {
    const call = request(app.getHttpServer())
      .get('/api/hotels/search')
      .query(query);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const inCity = (extra: Record<string, string | number> = {}) =>
    search({ cityId: CITY, ...STAY, guests: 2, ...extra });
  const names = (body: PageBody) => body.items.map((item) => item.name);

  const createHotel = async (
    label: string,
    fields: Partial<Hotel> = {},
  ): Promise<string> => {
    const hotel = await hotels.create({
      name: `${label} ${RUN}`,
      addressLine: '1 Test Street',
      cityId: CITY,
      countryCode: COUNTRY,
      description: 'A hotel created by the HTL-11 e2e test.',
      photos: [],
      starClass: 3,
      amenities: [],
      ...fields,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    ids[label] = id;
    return id;
  };

  const createRoom = async (
    hotelId: string,
    number: string,
    fields: Partial<Room> = {},
  ): Promise<string> => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(hotelId),
      number,
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: 10000,
      availability: [OPEN],
      ...fields,
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  const takeNight = (
    hotelId: string,
    roomId: string,
    date: string,
    state: RoomNightState,
    extra: Partial<RoomNight> = {},
  ) =>
    roomNights.create({
      roomId: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
      date,
      state,
      ...extra,
    });

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
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    await roomNights.init();

    // Alpha: two free rooms, for 2 and 3 guests.
    const alpha = await createHotel('Alpha');
    await createRoom(alpha, '101', { maxOccupancy: 2, pricePerNight: 9000 });
    await createRoom(alpha, '102', { maxOccupancy: 3, pricePerNight: 15000 });

    // Bravo: one room for 4, blocked on the second night of the stay.
    const bravo = await createHotel('Bravo');
    const bravoRoom = await createRoom(bravo, '1', { maxOccupancy: 4 });
    await takeNight(bravo, bravoRoom, '2099-03-11', RoomNightState.Blocked);

    // Charlie: a free room, but the hotel is deactivated (ACC-15).
    const charlie = await createHotel('Charlie', { active: false });
    await createRoom(charlie, '1');

    // Delta: its only room is deactivated (HTL-06).
    const delta = await createHotel('Delta');
    await createRoom(delta, '1', { active: false });

    // Echo: one room held until far in the future, one with an expired hold.
    const echo = await createHotel('Echo');
    const held = await createRoom(echo, '1', { maxOccupancy: 4 });
    const expired = await createRoom(echo, '2', { pricePerNight: 7000 });
    const holdBooking = new Types.ObjectId();
    await takeNight(echo, held, '2099-03-10', RoomNightState.Held, {
      bookingId: holdBooking,
      holdExpiresAt: new Date('2099-03-10T00:10:00.000Z'),
    });
    await takeNight(echo, expired, '2099-03-12', RoomNightState.Held, {
      bookingId: holdBooking,
      holdExpiresAt: new Date(Date.now() - 60_000),
    });

    // Foxtrot: booked on the last night of the stay; free on the check-out day.
    const foxtrot = await createHotel('Foxtrot');
    const foxRoom = await createRoom(foxtrot, '1');
    await takeNight(foxtrot, foxRoom, '2099-03-12', RoomNightState.Booked, {
      bookingId: new Types.ObjectId(),
    });

    // Golf: available only until the middle of the stay.
    const golf = await createHotel('Golf');
    await createRoom(golf, '1', {
      availability: [{ from: '2099-03-01', to: '2099-03-12' }],
    });

    // Hotel: in another city of the same country.
    const other = await createHotel('Hotel', { cityId: OTHER_CITY });
    await createRoom(other, '1');

    const user = await users.create({
      name: 'HTL-11 traveller',
      email: `htl11-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
    });
    userId = user._id.toString();
    userCookie = await sessionCookieFor(app, userId);
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await roomNights.deleteMany({ roomId: new Types.ObjectId(id) });
      await rooms.deleteOne({ _id: id });
    }
    for (const id of createdHotelIds) {
      await hotels.deleteOne({ _id: id });
    }
    if (userId) {
      await deleteSessionsOf(app, userId);
      await users.deleteOne({ _id: userId });
    }
    await app.close();
  });

  it('lists, for a guest, the active hotels with a room free for every night, by name', async () => {
    const response = await inCity().expect(200);
    const body = response.body as PageBody;

    expect(names(body)).toEqual([`Alpha ${RUN}`, `Echo ${RUN}`]);
    expect(body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(body.items[0]).toMatchObject({
      id: ids.Alpha,
      cityId: CITY,
      freeRooms: 2,
      lowestPricePerNight: 9000,
      currency: 'USD',
    });
    // Echo: the room with the expired hold is free; the held room is not.
    expect(body.items[1]).toMatchObject({
      freeRooms: 1,
      lowestPricePerNight: 7000,
    });
  });

  it('gives a logged-in user the same results', async () => {
    const asUser = await inCity().set('Cookie', userCookie).expect(200);
    const asGuest = await inCity().expect(200);

    expect(asUser.body).toEqual(asGuest.body);
  });

  it('needs the free rooms to hold the guests, and the number of rooms asked for', async () => {
    const three = await inCity({ guests: 3 }).expect(200);
    expect(names(three.body as PageBody)).toEqual([`Alpha ${RUN}`]);

    const fiveInTwo = await inCity({ guests: 5, rooms: 2 }).expect(200);
    expect(names(fiveInTwo.body as PageBody)).toEqual([`Alpha ${RUN}`]);

    const sixInTwo = await inCity({ guests: 6, rooms: 2 }).expect(200);
    expect(names(sixInTwo.body as PageBody)).toEqual([]);

    const fourInOne = await inCity({ guests: 4 }).expect(200);
    expect(names(fourInOne.body as PageBody)).toEqual([]);
  });

  it('lists a hotel again for a stay that misses its taken nights', async () => {
    // Bravo is blocked on 2099-03-11, Foxtrot booked on 2099-03-12, and Golf
    // available until 2099-03-12. The check-out day is not a night.
    const response = await search({
      cityId: CITY,
      checkIn: '2099-03-01',
      checkOut: '2099-03-11',
      guests: 4,
    }).expect(200);

    expect(names(response.body as PageBody)).toEqual([`Bravo ${RUN}`]);

    const short = await search({
      cityId: CITY,
      checkIn: '2099-03-10',
      checkOut: '2099-03-12',
      guests: 1,
    }).expect(200);
    expect(names(short.body as PageBody)).toEqual([
      `Alpha ${RUN}`,
      `Echo ${RUN}`,
      `Foxtrot ${RUN}`,
      `Golf ${RUN}`,
    ]);
  });

  it('searches a whole country', async () => {
    const response = await search({
      countryCode: COUNTRY,
      ...STAY,
      guests: 1,
    }).expect(200);
    const mine = (response.body as PageBody).items
      .filter((item) => createdHotelIds.includes(item.id))
      .map((item) => item.name);

    expect(mine).toEqual(
      expect.arrayContaining([`Alpha ${RUN}`, `Echo ${RUN}`, `Hotel ${RUN}`]),
    );
    expect(mine).not.toContain(`Charlie ${RUN}`);
  });

  it('pages the results and counts all of them', async () => {
    const response = await inCity({ guests: 1, page: 2, limit: 1 }).expect(200);

    expect(names(response.body as PageBody)).toEqual([`Echo ${RUN}`]);
    expect((response.body as PageBody).meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('answers an empty page for a city with no hotel', async () => {
    const response = await search({
      cityId: `htl11-nowhere-${RUN}`,
      ...STAY,
      guests: 1,
    }).expect(200);

    expect(response.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('accepts a check-in today (UTC)', async () => {
    const today = todayUtc();
    const next = new Date(`${today}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);

    await search({
      cityId: CITY,
      checkIn: today,
      checkOut: next.toISOString().slice(0, 10),
      guests: 1,
    }).expect(200);
  });

  it.each([
    ['no city and no country', { cityId: undefined }, 'cityId'],
    ['a city and a country', { countryCode: 'EG' }, 'cityId'],
    [
      'a check-in in the past',
      { checkIn: '2020-01-01', checkOut: '2020-01-05' },
      'checkIn',
    ],
    ['check-out on the check-in day', { checkOut: STAY.checkIn }, 'checkIn'],
    ['check-out before check-in', { checkOut: '2099-03-09' }, 'checkIn'],
    ['a date that is not YYYY-MM-DD', { checkIn: '10/03/2099' }, 'checkIn'],
    ['a date that does not exist', { checkIn: '2099-02-30' }, 'checkIn'],
    ['a stay of more than 366 nights', { checkOut: '2100-03-14' }, 'checkOut'],
    ['no guests', { guests: undefined }, 'guests'],
    ['0 guests', { guests: 0 }, 'guests'],
    ['1.5 guests', { guests: 1.5 }, 'guests'],
    ['0 rooms', { rooms: 0 }, 'rooms'],
    ['21 rooms', { rooms: 21 }, 'rooms'],
    [
      'a country code in lower case',
      { cityId: undefined, countryCode: 'eg' },
      'countryCode',
    ],
    ['an unknown parameter', { sort: 'price' }, 'sort'],
  ])('answers 400 for %s', async (_label, change, field) => {
    const query: Record<string, string | number> = {
      cityId: CITY,
      ...STAY,
      guests: 2,
    };
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete query[key];
      else query[key] = value;
    }

    const response = await search(query).expect(400);

    expect(JSON.stringify(response.body)).toContain(field);
  });

  it('is not read as the hotel page GET /api/hotels/:id', async () => {
    await request(app.getHttpServer())
      .get(`/api/hotels/${ids.Alpha}`)
      .expect(200);
    const response = await inCity().expect(200);
    expect(response.body).toHaveProperty('items');
  });

  it('documents the search in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const operation = response.body.paths['/api/hotels/search'].get as {
      tags: string[];
      description: string;
      parameters: { name: string; required: boolean }[];
      responses: Record<string, unknown>;
    };

    expect(operation.tags).toEqual(['hotels']);
    expect(operation.description).toMatch(/^HTL-11\. /);
    const parameters = Object.fromEntries(
      operation.parameters.map(({ name, required }) => [name, required]),
    );
    expect(parameters).toMatchObject({
      cityId: false,
      countryCode: false,
      checkIn: true,
      checkOut: true,
      guests: true,
      rooms: false,
      page: false,
      limit: false,
    });
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
    const schema = response.body.components.schemas
      .HotelSearchResultResponseDto as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'freeRooms',
        'lowestPricePerNight',
        'currency',
      ]),
    );
  });
});
