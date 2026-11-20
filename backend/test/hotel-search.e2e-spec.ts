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

describe('Hotel search (e2e, HTL-11, HTL-12)', () => {
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

  describe('filters and order (HTL-12)', () => {
    /** A city of its own, so these hotels never mix with the HTL-11 ones. */
    const CITY_12 = `htl12-city-${RUN}`;
    /** A country of its own too, so no country search of HTL-11 sees them. */
    const COUNTRY_12 = COUNTRY === 'QZ' ? 'QY' : 'QZ';
    const inCity12 = (extra: Record<string, string | number> = {}) =>
      search({ cityId: CITY_12, ...STAY, guests: 2, ...extra });
    const named = (...labels: string[]) =>
      labels.map((label) => `${label} ${RUN}`);
    const rating = (averageRating: number, ratingCount: number) => ({
      averageRating,
      ratingCount,
    });

    beforeAll(async () => {
      // The lowest price per night of each hotel is its cheapest FREE room:
      //   P-Alpha    8000  rated 4.5 (2)  also a room at 15000
      //   P-Bravo   12000  no rating
      //   P-Charlie 15000  rated 3   (1)
      //   P-Delta   20000  rated 5   (4)
      //   P-Echo    12000  rated 4   (3)
      //   P-Golf    18000  rated 4.5 (1)  its 5000 room is blocked
      //   P-Foxtrot 10000  rated 5   (9)  deactivated: never listed
      const city = { cityId: CITY_12, countryCode: COUNTRY_12 };
      const alpha = await createHotel('P-Alpha', {
        ...city,
        ...rating(4.5, 2),
      });
      await createRoom(alpha, '1', { pricePerNight: 8000 });
      await createRoom(alpha, '2', { pricePerNight: 15000 });

      const bravo = await createHotel('P-Bravo', city);
      await createRoom(bravo, '1', { pricePerNight: 12000 });

      const charlie = await createHotel('P-Charlie', {
        ...city,
        ...rating(3, 1),
      });
      await createRoom(charlie, '1', { pricePerNight: 15000 });

      const delta = await createHotel('P-Delta', { ...city, ...rating(5, 4) });
      await createRoom(delta, '1', { pricePerNight: 20000 });

      const echo = await createHotel('P-Echo', { ...city, ...rating(4, 3) });
      await createRoom(echo, '1', { pricePerNight: 12000 });

      const golf = await createHotel('P-Golf', { ...city, ...rating(4.5, 1) });
      const cheap = await createRoom(golf, '1', { pricePerNight: 5000 });
      await createRoom(golf, '2', { pricePerNight: 18000 });
      await takeNight(golf, cheap, '2099-03-11', RoomNightState.Blocked);

      const foxtrot = await createHotel('P-Foxtrot', {
        ...city,
        ...rating(5, 9),
        active: false,
      });
      await createRoom(foxtrot, '1', { pricePerNight: 10000 });
    });

    it('keeps the HTL-11 answer without the new parameters: every hotel, by name', async () => {
      const response = await inCity12().expect(200);
      const body = response.body as PageBody;

      expect(names(body)).toEqual(
        named('P-Alpha', 'P-Bravo', 'P-Charlie', 'P-Delta', 'P-Echo', 'P-Golf'),
      );
      expect(body.meta.total).toBe(6);
      const price = Object.fromEntries(
        body.items.map((item) => [item.name, item.lowestPricePerNight]),
      );
      expect(price[`P-Alpha ${RUN}`]).toBe(8000);
      expect(price[`P-Golf ${RUN}`]).toBe(18000);
    });

    it('keeps only hotels whose lowest price is at least minPrice, the bound included', async () => {
      const response = await inCity12({ minPrice: 12000 }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Bravo', 'P-Charlie', 'P-Delta', 'P-Echo', 'P-Golf'),
      );
    });

    it('keeps only hotels whose lowest price is at most maxPrice, the bound included', async () => {
      const response = await inCity12({ maxPrice: 12000 }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Alpha', 'P-Bravo', 'P-Echo'),
      );
    });

    it('includes both bounds of a range', async () => {
      const response = await inCity12({
        minPrice: 12000,
        maxPrice: 18000,
      }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Bravo', 'P-Charlie', 'P-Echo', 'P-Golf'),
      );
    });

    it('accepts minPrice equal to maxPrice and lists that exact price', async () => {
      const response = await inCity12({
        minPrice: 12000,
        maxPrice: 12000,
      }).expect(200);
      const body = response.body as PageBody;

      expect(names(body)).toEqual(named('P-Bravo', 'P-Echo'));
      expect(body.meta.total).toBe(2);
    });

    it('compares only the cheapest free room: a dearer room inside the range does not bring a hotel back', async () => {
      // P-Alpha has a room at 15000, inside the range, but its cheapest free
      // room is 8000. P-Golf's 5000 room is blocked, so its price is 18000.
      const inside = await inCity12({
        minPrice: 9000,
        maxPrice: 16000,
      }).expect(200);
      const cheap = await inCity12({ maxPrice: 6000 }).expect(200);

      expect(names(inside.body as PageBody)).toEqual(
        named('P-Bravo', 'P-Charlie', 'P-Echo'),
      );
      expect(names(cheap.body as PageBody)).toEqual([]);
    });

    it('keeps hotels rated at least minRating, the bound included, and leaves out unrated ones', async () => {
      const high = await inCity12({ minRating: 4.5 }).expect(200);
      const any = await inCity12({ minRating: 1 }).expect(200);

      expect(names(high.body as PageBody)).toEqual(
        named('P-Alpha', 'P-Delta', 'P-Golf'),
      );
      expect(names(any.body as PageBody)).toEqual(
        named('P-Alpha', 'P-Charlie', 'P-Delta', 'P-Echo', 'P-Golf'),
      );
    });

    it('sorts by price, cheapest first by default, a tie in the name order', async () => {
      const response = await inCity12({ sortBy: 'price' }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Alpha', 'P-Bravo', 'P-Echo', 'P-Charlie', 'P-Golf', 'P-Delta'),
      );
    });

    it('sorts by price dearest first with sortOrder=desc, a tie still in the name order', async () => {
      const response = await inCity12({
        sortBy: 'price',
        sortOrder: 'desc',
      }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Delta', 'P-Golf', 'P-Charlie', 'P-Bravo', 'P-Echo', 'P-Alpha'),
      );
    });

    it('sorts by rating best first by default, a tie in the name order, unrated last', async () => {
      const response = await inCity12({ sortBy: 'rating' }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Delta', 'P-Alpha', 'P-Golf', 'P-Echo', 'P-Charlie', 'P-Bravo'),
      );
    });

    it('sorts by rating worst first with sortOrder=asc, unrated still last', async () => {
      const response = await inCity12({
        sortBy: 'rating',
        sortOrder: 'asc',
      }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Charlie', 'P-Echo', 'P-Alpha', 'P-Golf', 'P-Delta', 'P-Bravo'),
      );
    });

    it('sorts by name in reverse with sortOrder=desc', async () => {
      const response = await inCity12({ sortOrder: 'desc' }).expect(200);

      expect(names(response.body as PageBody)).toEqual(
        named('P-Golf', 'P-Echo', 'P-Delta', 'P-Charlie', 'P-Bravo', 'P-Alpha'),
      );
    });

    it('filters and sorts before the pages: page 2 continues page 1 and total stays the same', async () => {
      // Rated 4 or more, cheapest first: Alpha 8000, Echo 12000, Golf 18000,
      // Delta 20000.
      const query = { minRating: 4, sortBy: 'price', limit: 2 };
      const first = await inCity12({ ...query, page: 1 }).expect(200);
      const second = await inCity12({ ...query, page: 2 }).expect(200);
      const meta = { limit: 2, total: 4, totalPages: 2 };

      expect(names(first.body as PageBody)).toEqual(named('P-Alpha', 'P-Echo'));
      expect(names(second.body as PageBody)).toEqual(
        named('P-Golf', 'P-Delta'),
      );
      expect((first.body as PageBody).meta).toEqual({ page: 1, ...meta });
      expect((second.body as PageBody).meta).toEqual({ page: 2, ...meta });
    });

    it('gives a logged-in user the same filtered and sorted page as a guest', async () => {
      const query = { maxPrice: 18000, sortBy: 'rating' };
      const asUser = await inCity12(query)
        .set('Cookie', userCookie)
        .expect(200);
      const asGuest = await inCity12(query).expect(200);

      expect(asUser.body).toEqual(asGuest.body);
      expect(names(asGuest.body as PageBody)).toEqual(
        named('P-Alpha', 'P-Golf', 'P-Echo', 'P-Charlie', 'P-Bravo'),
      );
    });

    it('never lists a deactivated hotel, whatever the filters and the order', async () => {
      // P-Foxtrot (deactivated) would be the only hotel at 10000 and the best
      // rated one.
      const queries: Record<string, string | number>[] = [
        { minPrice: 10000, maxPrice: 10000 },
        { minRating: 5 },
        { sortBy: 'rating' },
        { sortBy: 'price', sortOrder: 'desc', minRating: 1 },
      ];
      for (const query of queries) {
        const response = await inCity12(query).expect(200);
        expect(names(response.body as PageBody)).not.toContain(
          `P-Foxtrot ${RUN}`,
        );
      }
      const best = await inCity12({ minRating: 5 }).expect(200);
      expect(names(best.body as PageBody)).toEqual(named('P-Delta'));
    });

    it('answers 400 on minPrice when it is above maxPrice', async () => {
      const response = await inCity12({
        minPrice: 20000,
        maxPrice: 10000,
      }).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
        errors: [
          {
            field: 'minPrice',
            messages: ['minPrice must not be greater than maxPrice'],
          },
        ],
      });
    });

    it.each([
      [
        'a decimal minPrice',
        { minPrice: '12.5' },
        'minPrice',
        'minPrice must be a whole number of minor units (cents)',
      ],
      [
        'a negative minPrice',
        { minPrice: -1 },
        'minPrice',
        'minPrice must be 0 or more',
      ],
      [
        'a minPrice above the highest room price',
        { minPrice: 1_000_000_001 },
        'minPrice',
        'minPrice must be at most 1000000000',
      ],
      [
        'a decimal maxPrice',
        { maxPrice: '99.99' },
        'maxPrice',
        'maxPrice must be a whole number of minor units (cents)',
      ],
      [
        'a negative maxPrice',
        { maxPrice: -5 },
        'maxPrice',
        'maxPrice must be 0 or more',
      ],
      [
        'a maxPrice above the highest room price',
        { maxPrice: 1_000_000_001 },
        'maxPrice',
        'maxPrice must be at most 1000000000',
      ],
      [
        'a minRating of 0.9',
        { minRating: 0.9 },
        'minRating',
        'minRating must be at least 1',
      ],
      [
        'a minRating of 5.1',
        { minRating: 5.1 },
        'minRating',
        'minRating must be at most 5',
      ],
      [
        'a minRating that is not a number',
        { minRating: 'abc' },
        'minRating',
        'minRating must be a number from 1 to 5',
      ],
      [
        'an unknown sortBy',
        { sortBy: 'stars' },
        'sortBy',
        'sortBy must be one of: name, price, rating',
      ],
      [
        'an unknown sortOrder',
        { sortOrder: 'up' },
        'sortOrder',
        'sortOrder must be one of: asc, desc',
      ],
      [
        'an unknown parameter',
        { maxRating: 5 },
        'maxRating',
        'property maxRating should not exist',
      ],
    ])('answers 400 for %s', async (_label, change, field, message) => {
      const response = await inCity12(change).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
      });
      expect(response.body.errors).toEqual([
        { field, messages: expect.arrayContaining([message]) },
      ]);
    });

    it('documents the filters and the order in Swagger', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const operation = response.body.paths['/api/hotels/search'].get as {
        summary: string;
        description: string;
        parameters: {
          name: string;
          required: boolean;
          schema: Record<string, unknown>;
        }[];
        responses: Record<string, { description: string }>;
      };
      const parameter = (name: string) =>
        operation.parameters.find((each) => each.name === name);

      expect(operation.summary).toBe('Search hotels (HTL-11, HTL-12)');
      expect(operation.description).toContain('HTL-12');
      for (const name of [
        'minPrice',
        'maxPrice',
        'minRating',
        'sortBy',
        'sortOrder',
      ]) {
        expect(parameter(name)).toMatchObject({ required: false });
      }
      expect(parameter('minPrice')?.schema).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: 1_000_000_000,
      });
      expect(parameter('minRating')?.schema).toMatchObject({
        type: 'number',
        minimum: 1,
        maximum: 5,
      });
      expect(parameter('sortBy')?.schema).toMatchObject({
        enum: ['name', 'price', 'rating'],
        default: 'name',
      });
      expect(parameter('sortOrder')?.schema).toMatchObject({
        enum: ['asc', 'desc'],
      });
      expect(operation.responses['400'].description).toContain(
        'minPrice must not be greater than maxPrice',
      );
      // The response shape is unchanged.
      expect(
        Object.keys(response.body.components.schemas).filter((name) =>
          name.startsWith('HotelSearchResultResponseDto'),
        ),
      ).toEqual(['HotelSearchResultResponseDto']);
    });
  });
});
