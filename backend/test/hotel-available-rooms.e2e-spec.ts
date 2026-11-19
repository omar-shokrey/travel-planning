import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { HotelsService } from './../src/hotels/hotels.service';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);
/** A city id no other suite uses, so hotel search finds only this file's hotels. */
const CITY = `htl15-city-${RUN}`;
/** A country code; nothing here searches by country, so a shared code is harmless. */
const COUNTRY = `X${String.fromCharCode(65 + randomInt(26))}`;

/** Dates far in the future, so "check-in in the past" never trips. */
const OPEN = { from: '2099-05-01', to: '2099-06-01' };
/** The searched stay: three nights (10, 11, 12 May); check-out on 13 May. */
const STAY = { checkIn: '2099-05-10', checkOut: '2099-05-13' };
const ONE_NIGHT = { checkIn: '2099-05-10', checkOut: '2099-05-11' };
/** A stay outside every availability range: nothing is free. */
const NOTHING_FREE = { checkIn: '2099-07-01', checkOut: '2099-07-03' };

/** A date `days` after today (UTC), for the rules about "today". */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface RoomBody {
  id: string;
  number: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  nights: number;
  totalPrice: number;
  currency: string;
}
interface PageBody<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
interface SearchItem {
  id: string;
  freeRooms: number;
  lowestPricePerNight: number;
}
interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  errors?: { field: string; messages: string[] }[];
  path: string;
  timestamp: string;
}

describe('Available rooms for the searched dates (e2e, HTL-15, HTL-02)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdNightIds: string[] = [];
  let userId = '';
  let userCookie = '';

  let hotelId = '';
  let deactivatedHotelId = '';
  /** Room id by room number, for the hotel under test. */
  const roomIds: Record<string, string> = {};

  const available = (
    query: Record<string, string | number>,
    hotel = hotelId,
    cookie?: string,
  ) => {
    const call = request(app.getHttpServer())
      .get(`/api/hotels/${hotel}/rooms/available`)
      .query(query);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const hotelPage = (query: Record<string, string>, hotel = hotelId) =>
    request(app.getHttpServer()).get(`/api/hotels/${hotel}`).query(query);
  const search = (query: Record<string, string | number>) =>
    request(app.getHttpServer()).get('/api/hotels/search').query(query);

  const numbers = (body: PageBody<RoomBody>) =>
    body.items.map((room) => room.number);
  /** The 400 body without the parts that differ by request (path, time). */
  const comparable = ({ statusCode, error, message, errors }: ErrorBody) => ({
    statusCode,
    error,
    message,
    errors,
  });

  const hotelFields = (label: string, active: boolean) => ({
    name: `HTL-15 ${label} ${RUN}`,
    addressLine: '1 Test Street',
    cityId: CITY,
    countryCode: COUNTRY,
    description: 'A hotel created by the HTL-15 e2e test.',
    photos: [],
    starClass: 4,
    amenities: [],
    active,
  });

  const roomFields = (
    hotel: string,
    number: string,
    fields: Partial<Room> = {},
  ) => ({
    hotelId: new Types.ObjectId(hotel),
    number,
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12000,
    availability: [OPEN],
    ...fields,
  });

  const nightFields = (
    number: string,
    date: string,
    state: RoomNightState,
    holdExpiresAt?: Date,
  ) => ({
    roomId: new Types.ObjectId(roomIds[number]),
    hotelId: new Types.ObjectId(hotelId),
    date,
    state,
    ...(state !== RoomNightState.Blocked && {
      bookingId: new Types.ObjectId(),
    }),
    ...(holdExpiresAt && { holdExpiresAt }),
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

    const [open, closed] = await hotels.insertMany([
      hotelFields('open', true),
      hotelFields('deactivated', false),
    ]);
    hotelId = open._id.toString();
    deactivatedHotelId = closed._id.toString();
    createdHotelIds.push(hotelId, deactivatedHotelId);

    // One room per case of the free-room rule. Free for STAY: 1, 2, 10, 11,
    // 12 and 14.
    const created = await rooms.insertMany([
      // Free, the cheapest that is not on hold.
      roomFields(hotelId, '1', {
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        pricePerNight: 9000,
      }),
      // Free, a larger room.
      roomFields(hotelId, '2', {
        type: 'Suite',
        beds: 2,
        maxOccupancy: 4,
        pricePerNight: 25000,
      }),
      // Free; sorted after 2 because the digits compare as numbers.
      roomFields(hotelId, '10'),
      // A hole in the availability on 11 May, in the middle of the stay.
      roomFields(hotelId, '3', {
        availability: [
          { from: '2099-05-01', to: '2099-05-11' },
          { from: '2099-05-12', to: '2099-06-01' },
        ],
      }),
      // Bookable up to 11 May only: misses the last night.
      roomFields(hotelId, '4', {
        availability: [{ from: '2099-05-01', to: '2099-05-12' }],
      }),
      // Bookable from 11 May only: misses the first night.
      roomFields(hotelId, '5', {
        availability: [{ from: '2099-05-11', to: '2099-06-01' }],
      }),
      // Deactivated (HTL-06).
      roomFields(hotelId, '6', { active: false }),
      // Booked on 11 May.
      roomFields(hotelId, '7'),
      // Blocked on 12 May (HTL-06).
      roomFields(hotelId, '8'),
      // Held on 10 May by a hold that has not expired (HTL-18).
      roomFields(hotelId, '9'),
      // Held on 11 May by a hold that has expired: free, and the cheapest.
      roomFields(hotelId, '11', { pricePerNight: 7000 }),
      // Booked on the check-out day only: free.
      roomFields(hotelId, '12'),
      // Free only after the searched dates.
      roomFields(hotelId, '13', {
        availability: [{ from: '2099-05-13', to: '2099-06-01' }],
      }),
      // Two ranges that touch inside the stay: free.
      roomFields(hotelId, '14', {
        availability: [
          { from: '2099-05-01', to: '2099-05-11' },
          { from: '2099-05-11', to: '2099-06-01' },
        ],
      }),
      // The deactivated hotel's only room, free.
      roomFields(deactivatedHotelId, '901'),
    ]);
    for (const room of created) {
      createdRoomIds.push(room._id.toString());
      if (room.hotelId.toString() === hotelId) {
        roomIds[room.number] = room._id.toString();
      }
    }

    const nights = await roomNights.insertMany([
      nightFields('7', '2099-05-11', RoomNightState.Booked),
      nightFields('8', '2099-05-12', RoomNightState.Blocked),
      nightFields(
        '9',
        '2099-05-10',
        RoomNightState.Held,
        new Date('2099-05-10T00:10:00.000Z'),
      ),
      nightFields(
        '11',
        '2099-05-11',
        RoomNightState.Held,
        new Date(Date.now() - 60_000),
      ),
      nightFields('12', STAY.checkOut, RoomNightState.Booked),
    ]);
    createdNightIds.push(...nights.map((night) => night._id.toString()));

    const user = await users.create({
      name: 'HTL-15 traveller',
      email: `htl15-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      consentAcceptedAt: new Date(),
    });
    userId = user._id.toString();
    userCookie = await sessionCookieFor(app, userId);
  });

  afterAll(async () => {
    for (const id of createdNightIds) {
      await roomNights.findByIdAndDelete(id);
    }
    for (const id of createdRoomIds) {
      await rooms.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    if (userId) {
      await deleteSessionsOf(app, userId);
      await users.findByIdAndDelete(userId);
    }
    await app.close();
  });

  describe('GET /api/hotels/:id/rooms/available', () => {
    it('lists for a guest every room free for the whole stay, by room number, with the stay price', async () => {
      const response = await available(STAY).expect(200);
      const body = response.body as PageBody<RoomBody>;

      expect(numbers(body)).toEqual(['1', '2', '10', '11', '12', '14']);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 6,
        totalPages: 1,
      });
      expect(body.items.slice(0, 3)).toEqual([
        {
          id: roomIds['1'],
          number: '1',
          type: 'Single',
          beds: 1,
          maxOccupancy: 1,
          pricePerNight: 9000,
          nights: 3,
          totalPrice: 27000,
          currency: 'USD',
        },
        {
          id: roomIds['2'],
          number: '2',
          type: 'Suite',
          beds: 2,
          maxOccupancy: 4,
          pricePerNight: 25000,
          nights: 3,
          totalPrice: 75000,
          currency: 'USD',
        },
        {
          id: roomIds['10'],
          number: '10',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          pricePerNight: 12000,
          nights: 3,
          totalPrice: 36000,
          currency: 'USD',
        },
      ]);
      for (const room of body.items) {
        expect(room.totalPrice).toBe(room.nights * room.pricePerNight);
      }
    });

    it('gives a logged-in user the same answer as a guest', async () => {
      const asGuest = await available(STAY).expect(200);
      const asUser = await available(STAY, hotelId, userCookie).expect(200);

      expect(asUser.body).toEqual(asGuest.body);
    });

    it('prices a one-night stay at one night, and lists the rooms free that night', async () => {
      const response = await available(ONE_NIGHT).expect(200);
      const body = response.body as PageBody<RoomBody>;

      // 3 and 4 are bookable on 10 May; 7 and 8 are taken only later; 9 is
      // held that night; 5 and 13 open later; 6 is deactivated.
      expect(numbers(body)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '7',
        '8',
        '10',
        '11',
        '12',
        '14',
      ]);
      for (const room of body.items) {
        expect(room.nights).toBe(1);
        expect(room.totalPrice).toBe(room.pricePerNight);
      }
    });

    it("gives each room's id, the id of that room of this hotel, which a booking selects", async () => {
      const response = await available(STAY).expect(200);

      for (const item of (response.body as PageBody<RoomBody>).items) {
        const stored = await rooms.findById(item.id).lean().exec();
        expect(stored?.hotelId.toString()).toBe(hotelId);
        expect(stored?.number).toBe(item.number);
      }
    });

    it('answers an empty page when no room is free', async () => {
      const response = await available(NOTHING_FREE).expect(200);

      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('pages the free rooms and counts all of them', async () => {
      const second = await available({ ...STAY, page: 2, limit: 1 }).expect(
        200,
      );
      expect(numbers(second.body as PageBody<RoomBody>)).toEqual(['2']);
      expect((second.body as PageBody<RoomBody>).meta).toEqual({
        page: 2,
        limit: 1,
        total: 6,
        totalPages: 6,
      });

      const last = await available({ ...STAY, page: 2, limit: 4 }).expect(200);
      expect(numbers(last.body as PageBody<RoomBody>)).toEqual(['12', '14']);

      const past = await available({ ...STAY, page: 3, limit: 4 }).expect(200);
      expect((past.body as PageBody<RoomBody>).items).toEqual([]);
      expect((past.body as PageBody<RoomBody>).meta.total).toBe(6);
    });

    it('accepts a stay that starts today (UTC)', async () => {
      await available({ checkIn: day(0), checkOut: day(1) }).expect(200);
    });

    it('writes nothing: the nights and rooms of the hotel are unchanged', async () => {
      const before = await Promise.all([
        roomNights.countDocuments({ hotelId }).exec(),
        rooms
          .find({ hotelId })
          .select('updatedAt')
          .sort({ _id: 1 })
          .lean()
          .exec(),
      ]);

      await available(STAY).expect(200);
      await available(STAY, hotelId, userCookie).expect(200);
      await hotelPage(STAY).expect(200);

      const after = await Promise.all([
        roomNights.countDocuments({ hotelId }).exec(),
        rooms
          .find({ hotelId })
          .select('updatedAt')
          .sort({ _id: 1 })
          .lean()
          .exec(),
      ]);
      expect(after).toEqual(before);
      expect(before[0]).toBe(createdNightIds.length);
    });

    it.each([
      ['no dates', {}, ['checkIn', 'checkOut']],
      ['no check-in', { checkOut: STAY.checkOut }, ['checkIn']],
      ['no check-out', { checkIn: STAY.checkIn }, ['checkIn', 'checkOut']],
      [
        'a date that does not exist',
        { ...STAY, checkIn: '2099-02-30' },
        ['checkIn'],
      ],
      [
        'a date that is not YYYY-MM-DD',
        { ...STAY, checkIn: '10/05/2099' },
        ['checkIn'],
      ],
      [
        'check-out on the check-in day',
        { ...STAY, checkOut: STAY.checkIn },
        ['checkIn'],
      ],
      [
        'check-out before check-in',
        { ...STAY, checkOut: '2099-05-09' },
        ['checkIn'],
      ],
      [
        'a check-in in the past',
        { checkIn: day(-1), checkOut: day(2) },
        ['checkIn'],
      ],
      [
        'a stay of 367 nights',
        { checkIn: day(1), checkOut: day(368) },
        ['checkOut'],
      ],
      ['an unknown parameter', { ...STAY, guests: 2 }, ['guests']],
      ['page 0', { ...STAY, page: 0 }, ['page']],
      ['limit 51', { ...STAY, limit: 51 }, ['limit']],
      ['limit as text', { ...STAY, limit: 'ten' }, ['limit']],
    ])(
      'answers 400 for %s, naming the field',
      async (_label, query, fields) => {
        const response = await available(query).expect(400);
        const body = response.body as ErrorBody;

        expect(body.errors?.map((entry) => entry.field)).toEqual(fields);
      },
    );

    it('accepts a stay of exactly 366 nights', async () => {
      await available({ checkIn: day(1), checkOut: day(367) }).expect(200);
    });

    it('answers 400 for a hotel id that is not an id', async () => {
      await available(STAY, 'not-an-id').expect(400);
    });

    it('answers 404 for a hotel that does not exist', async () => {
      const response = await available(
        STAY,
        new Types.ObjectId().toString(),
      ).expect(404);

      expect((response.body as ErrorBody).message).toBe('Hotel not found');
    });

    it('answers 404 for a deactivated hotel (ACC-15), and lists its rooms again once reactivated', async () => {
      const deactivated = await available(STAY, deactivatedHotelId).expect(404);
      expect((deactivated.body as ErrorBody).message).toBe('Hotel not found');

      const hotelsService = app.get(HotelsService);
      await hotelsService.setActive(deactivatedHotelId, true);
      try {
        const reactivated = await available(STAY, deactivatedHotelId).expect(
          200,
        );
        expect(numbers(reactivated.body as PageBody<RoomBody>)).toEqual([
          '901',
        ]);
      } finally {
        await hotelsService.setActive(deactivatedHotelId, false);
      }

      await available(STAY, deactivatedHotelId).expect(404);
    });
  });

  describe('agrees with hotel search (HTL-11)', () => {
    it.each([
      ['the three-night stay', STAY],
      ['one night', ONE_NIGHT],
      [
        'the last night only',
        { checkIn: '2099-05-12', checkOut: '2099-05-13' },
      ],
      [
        'a stay across the expired hold',
        { checkIn: '2099-05-11', checkOut: '2099-05-14' },
      ],
      ['the whole month', { checkIn: OPEN.from, checkOut: OPEN.to }],
      ['a stay with nothing free', NOTHING_FREE],
    ])(
      'for %s: the listed rooms are the free rooms search counts, and its lowest price is theirs',
      async (_label, stay) => {
        const listed = (await available({ ...stay, limit: 50 }).expect(200))
          .body as PageBody<RoomBody>;
        const found = (
          await search({ cityId: CITY, ...stay, guests: 1 }).expect(200)
        ).body as PageBody<SearchItem>;
        const result = found.items.find((item) => item.id === hotelId);

        if (listed.meta.total === 0) {
          expect(result).toBeUndefined();
          return;
        }
        expect(result?.freeRooms).toBe(listed.meta.total);
        expect(listed.items).toHaveLength(listed.meta.total);
        expect(result?.lowestPricePerNight).toBe(
          Math.min(...listed.items.map((room) => room.pricePerNight)),
        );
      },
    );

    it('the deactivated hotel is in neither', async () => {
      const found = (
        await search({ cityId: CITY, ...STAY, guests: 1 }).expect(200)
      ).body as PageBody<SearchItem>;

      expect(found.items.map((item) => item.id)).toEqual([hotelId]);
      await available(STAY, deactivatedHotelId).expect(404);
    });

    it.each([
      ['a check-in in the past', { checkIn: day(-1), checkOut: day(2) }],
      ['a stay of 367 nights', { checkIn: day(1), checkOut: day(368) }],
      ['check-out on the check-in day', { checkIn: day(2), checkOut: day(2) }],
      [
        'a date that does not exist',
        { checkIn: '2099-02-30', checkOut: '2099-03-02' },
      ],
    ])(
      'answers %s with the same 400 body as hotel search and the hotel page',
      async (_label, stay) => {
        const fromRooms = await available(stay).expect(400);
        const fromSearch = await search({
          cityId: CITY,
          ...stay,
          guests: 1,
        }).expect(400);
        const fromPage = await hotelPage(stay).expect(400);

        expect(comparable(fromRooms.body as ErrorBody)).toEqual(
          comparable(fromSearch.body as ErrorBody),
        );
        expect(comparable(fromPage.body as ErrorBody)).toEqual(
          comparable(fromSearch.body as ErrorBody),
        );
        expect((fromSearch.body as ErrorBody).errors?.length).toBe(1);
      },
    );
  });

  describe('GET /api/hotels/:id with dates (HTL-02)', () => {
    it('shows availableRooms: null without dates', async () => {
      const response = await hotelPage({}).expect(200);

      expect(response.body).toMatchObject({ id: hotelId });
      expect(response.body.availableRooms).toBeNull();
    });

    it('shows every free room, the full list of the route, with both dates', async () => {
      const page = await hotelPage(STAY).expect(200);
      const listed = await available({ ...STAY, limit: 50 }).expect(200);

      expect(page.body.id).toBe(hotelId);
      expect(page.body.availableRooms).toEqual(
        (listed.body as PageBody<RoomBody>).items,
      );
    });

    it('shows an empty list with dates when nothing is free', async () => {
      const response = await hotelPage(NOTHING_FREE).expect(200);

      expect(response.body.availableRooms).toEqual([]);
    });

    it.each([
      ['only check-in', { checkIn: STAY.checkIn }, 'checkOut'],
      ['only check-out', { checkOut: STAY.checkOut }, 'checkIn'],
    ])('answers 400 for %s', async (_label, query, field) => {
      const response = await hotelPage(query).expect(400);

      expect(
        (response.body as ErrorBody).errors?.map((entry) => entry.field),
      ).toContain(field);
    });

    it('answers 404 for a deactivated hotel, with or without dates', async () => {
      await hotelPage(STAY, deactivatedHotelId).expect(404);
      await hotelPage({}, deactivatedHotelId).expect(404);
    });
  });

  describe('Swagger', () => {
    it('documents the route as public, in the hotels group, with every room field described', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const doc = response.body as {
        paths: Record<
          string,
          {
            get: {
              tags: string[];
              description: string;
              security?: unknown;
              parameters: { name: string; required: boolean }[];
              responses: Record<string, unknown>;
            };
          }
        >;
        components: {
          schemas: Record<
            string,
            {
              properties: Record<
                string,
                { description?: string; example?: unknown; nullable?: boolean }
              >;
            }
          >;
        };
      };
      const operation = doc.paths['/api/hotels/{id}/rooms/available'].get;

      expect(operation.tags).toEqual(['hotels']);
      expect(operation.security).toBeUndefined();
      expect(operation.description).toMatch(/^HTL-15\. /);
      expect(
        Object.fromEntries(
          operation.parameters.map(({ name, required }) => [name, required]),
        ),
      ).toEqual({
        id: true,
        checkIn: true,
        checkOut: true,
        page: false,
        limit: false,
      });
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400', '404']),
      );

      const room = doc.components.schemas.AvailableRoomResponseDto.properties;
      expect(Object.keys(room).sort()).toEqual([
        'beds',
        'currency',
        'id',
        'maxOccupancy',
        'nights',
        'number',
        'pricePerNight',
        'totalPrice',
        'type',
      ]);
      for (const [name, property] of Object.entries(room)) {
        expect([name, property.description]).toEqual([
          name,
          expect.any(String),
        ]);
        expect([name, property.example]).toEqual([name, expect.anything()]);
      }

      const page = doc.paths['/api/hotels/{id}'].get;
      expect(page.security).toBeUndefined();
      expect(
        Object.fromEntries(
          page.parameters.map(({ name, required }) => [name, required]),
        ),
      ).toEqual({ id: true, checkIn: false, checkOut: false });
      expect(
        doc.components.schemas.HotelDetailsResponseDto.properties
          .availableRooms,
      ).toMatchObject({ nullable: true, description: expect.any(String) });
    });
  });
});
