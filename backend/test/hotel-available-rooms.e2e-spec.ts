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

/** A date `days` after today (UTC), so the test never falls in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

const range = (from: string, to: string) => ({ from, to });

// The searched stay: three nights, check-out on day 13.
const CHECK_IN = day(10);
const CHECK_OUT = day(13);

describe('Available rooms for the searched dates (e2e, HTL-15)', () => {
  let app: NestExpressApplication;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];

  let hotelId: string;
  let inactiveHotelId: string;
  const roomIds = new Map<string, string>();

  const available = (query: Record<string, string>, hotel = () => hotelId) =>
    request(app.getHttpServer())
      .get(`/api/hotels/${hotel()}/rooms/available`)
      .query(query);

  const details = (query: Record<string, string>, hotel = () => hotelId) =>
    request(app.getHttpServer()).get(`/api/hotels/${hotel()}`).query(query);

  const createRoom = async (
    owner: string,
    number: string,
    fields: Partial<Room> = {},
  ): Promise<string> => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(owner),
      number,
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      availability: [range(day(0), day(60))],
      ...fields,
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    roomIds.set(number, id);
    return id;
  };

  const night = (
    number: string,
    date: string,
    state: RoomNightState,
    holdExpiresAt?: Date,
  ) => ({
    roomId: new Types.ObjectId(roomIds.get(number)),
    hotelId: new Types.ObjectId(hotelId),
    date,
    state,
    ...(state !== RoomNightState.Blocked && {
      bookingId: new Types.ObjectId(),
    }),
    holdExpiresAt,
  });

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

    const hotel = (label: string, active: boolean) => ({
      name: `HTL-15 ${label} hotel ${RUN}`,
      addressLine: '12 Nile Street',
      cityId: 'htl15-test-city',
      countryCode: 'HTL15',
      description: 'A hotel created by the HTL-15 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      active,
    });
    const [open, closed] = await hotels.insertMany([
      hotel('open', true),
      hotel('deactivated', false),
    ]);
    hotelId = open._id.toString();
    inactiveHotelId = closed._id.toString();
    createdHotelIds.push(hotelId, inactiveHotelId);

    await createRoom(hotelId, '101', { pricePerNight: 10000 });
    await createRoom(hotelId, '102', { active: false });
    await createRoom(hotelId, '103');
    await createRoom(hotelId, '104');
    await createRoom(hotelId, '105');
    await createRoom(hotelId, '106', { type: 'Suite', maxOccupancy: 4 });
    await createRoom(hotelId, '107', {
      availability: [range(day(0), day(11))],
    });
    await createRoom(hotelId, '108');
    await createRoom(inactiveHotelId, '901');

    await roomNights.insertMany([
      night('103', day(11), RoomNightState.Booked),
      night('104', day(12), RoomNightState.Blocked),
      night(
        '105',
        day(10),
        RoomNightState.Held,
        new Date(Date.now() + 10 * 60 * 1000),
      ),
      // A hold whose time has passed no longer counts.
      night(
        '106',
        day(10),
        RoomNightState.Held,
        new Date(Date.now() - 60 * 1000),
      ),
      // The check-out day is not a night of the stay.
      night('108', CHECK_OUT, RoomNightState.Booked),
      night('108', day(9), RoomNightState.Booked),
    ]);
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

  describe('GET /api/hotels/:id/rooms/available', () => {
    it('lists, without login, only the rooms free for the whole stay', async () => {
      const response = await available({
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
      });

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([
        {
          id: roomIds.get('101'),
          number: '101',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          pricePerNight: 10000,
          nights: 3,
          totalPrice: 30000,
          currency: 'USD',
        },
        {
          id: roomIds.get('106'),
          number: '106',
          type: 'Suite',
          beds: 2,
          maxOccupancy: 4,
          pricePerNight: 12500,
          nights: 3,
          totalPrice: 37500,
          currency: 'USD',
        },
        {
          id: roomIds.get('108'),
          number: '108',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          pricePerNight: 12500,
          nights: 3,
          totalPrice: 37500,
          currency: 'USD',
        },
      ]);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('pages through the free rooms', async () => {
      const response = await available({
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        page: '2',
        limit: '2',
      });

      expect(response.status).toBe(200);
      expect(
        response.body.items.map((room: { number: string }) => room.number),
      ).toEqual(['108']);
      expect(response.body.meta.total).toBe(3);
    });

    it('accepts a stay that starts today', async () => {
      const response = await available({ checkIn: day(0), checkOut: day(1) });
      expect(response.status).toBe(200);
    });

    it.each([
      ['no dates', {}],
      ['only check-in', { checkIn: day(10) }],
      ['check-out before check-in', { checkIn: day(12), checkOut: day(10) }],
      ['check-out on check-in', { checkIn: day(10), checkOut: day(10) }],
      ['a check-in in the past', { checkIn: day(-1), checkOut: day(2) }],
      ['a stay of 367 nights', { checkIn: day(1), checkOut: day(368) }],
      ['a date that is not real', { checkIn: '2026-02-30', checkOut: day(3) }],
      ['an unknown parameter', { checkIn: day(1), checkOut: day(2), x: '1' }],
    ])('answers 400 for %s', async (_, query) => {
      const response = await available(query as Record<string, string>);
      expect(response.status).toBe(400);
    });

    it('answers 400 for a hotel id that is not an id', async () => {
      const response = await available(
        { checkIn: CHECK_IN, checkOut: CHECK_OUT },
        () => 'not-an-id',
      );
      expect(response.status).toBe(400);
    });

    it('answers 404 for a deactivated hotel', async () => {
      const response = await available(
        { checkIn: CHECK_IN, checkOut: CHECK_OUT },
        () => inactiveHotelId,
      );
      expect(response.status).toBe(404);
    });

    it('answers 404 for a hotel that does not exist', async () => {
      const response = await available(
        { checkIn: CHECK_IN, checkOut: CHECK_OUT },
        () => new Types.ObjectId().toString(),
      );
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/hotels/:id with dates (HTL-02)', () => {
    it('shows the free rooms on the hotel page when dates are given', async () => {
      const response = await details({
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
      });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(hotelId);
      expect(
        response.body.availableRooms.map(
          (room: { number: string; totalPrice: number }) => [
            room.number,
            room.totalPrice,
          ],
        ),
      ).toEqual([
        ['101', 30000],
        ['106', 37500],
        ['108', 37500],
      ]);
    });

    it('shows no rooms list without dates', async () => {
      const response = await details({});

      expect(response.status).toBe(200);
      expect(response.body.availableRooms).toBeNull();
    });

    it.each([
      ['only check-in', { checkIn: day(10) }],
      ['only check-out', { checkOut: day(10) }],
      ['a check-in in the past', { checkIn: day(-1), checkOut: day(2) }],
    ])('answers 400 for %s', async (_, query) => {
      const response = await details(query as Record<string, string>);
      expect(response.status).toBe(400);
    });
  });
});
