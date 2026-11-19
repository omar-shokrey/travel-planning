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
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingExpiryService } from './../src/hotel-bookings/hotel-booking-expiry.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);
/** A city id no other suite uses. */
const CITY = `htl16-city-${RUN}`;

/** A date `days` after today (UTC), so the test never falls in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface BookingBody {
  id: string;
  reference: string | null;
  hotelId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  holdExpiresAt: string | null;
  currency: string;
  total: number;
  rooms: {
    roomId: string;
    roomLabel: string;
    pricePerNight: number;
    subtotal: number;
    adults: number;
    childAges: number[];
  }[];
  checkInTime: string | null;
  checkOutTime: string | null;
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  createdAt: string;
}
interface ErrorBody {
  statusCode: number;
  message: string;
  errors?: { field: string; messages: string[] }[];
}

describe('Book hotel rooms and hold them for payment (e2e, HTL-16, HTL-18)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;
  let bookings: Model<HotelBooking>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdNightIds: string[] = [];
  const cookies = new Map<string, string>();
  const userIds = new Map<string, string>();

  let hotelId: string;
  let plainHotelId: string;
  let closedHotelId: string;
  const room: Record<string, string> = {};

  const book = (who: string | undefined, payload: Record<string, unknown>) => {
    const call = request(app.getHttpServer())
      .post('/api/hotel-bookings')
      .send(payload);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  /** A valid request for one adult in each room, changed by `fields`. */
  const body = (
    roomIds: string[],
    checkIn: string,
    checkOut: string,
    fields: Record<string, unknown> = {},
  ) => ({
    hotelId,
    checkIn,
    checkOut,
    rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
    ...fields,
  });

  const createHotel = async (label: string, fields: Partial<Hotel> = {}) => {
    const hotel = await hotels.create({
      name: `HTL-16 ${label} hotel ${RUN}`,
      addressLine: '16 Nile Street',
      cityId: CITY,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-16 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      ...fields,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    return id;
  };

  const createRoom = async (
    owner: string,
    number: string,
    fields: Partial<Room> = {},
  ) => {
    const created = await rooms.create({
      hotelId: new Types.ObjectId(owner),
      number,
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      pricePerNight: 10000,
      availability: [{ from: day(0), to: day(120) }],
      ...fields,
    });
    const id = created._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  const nightsOf = (bookingId: string) =>
    roomNights
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ roomId: 1, date: 1 })
      .lean()
      .exec();

  const nightsOfRoom = (roomId: string) =>
    roomNights
      .find({ roomId: new Types.ObjectId(roomId) })
      .sort({ date: 1 })
      .lean()
      .exec();

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
    bookings = app.get<Model<HotelBooking>>(getModelToken(HotelBooking.name));
    // The unique (roomId, date) index must exist before the race test.
    await roomNights.init();
    await bookings.init();

    hotelId = await createHotel('main', {
      policy: {
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [
          { daysBefore: 2, refundPercent: 50 },
          { daysBefore: 14, refundPercent: 100 },
        ],
      },
    });
    plainHotelId = await createHotel('plain');
    closedHotelId = await createHotel('closed', { active: false });

    room.double = await createRoom(hotelId, '101', { pricePerNight: 12500 });
    room.family = await createRoom(hotelId, '102', {
      type: 'Family',
      maxOccupancy: 4,
      pricePerNight: 20000,
    });
    room.single = await createRoom(hotelId, '103', {
      type: 'Single',
      maxOccupancy: 1,
    });
    room.race = await createRoom(hotelId, '104');
    room.blocked = await createRoom(hotelId, '105');
    room.inactive = await createRoom(hotelId, '106', { active: false });
    room.short = await createRoom(hotelId, '107', {
      availability: [{ from: day(0), to: day(5) }],
    });
    room.expiring = await createRoom(hotelId, '108');
    room.priced = await createRoom(hotelId, '109');
    room.booked = await createRoom(hotelId, '110');
    room.adjacent = await createRoom(hotelId, '111');
    room.lapsed = await createRoom(hotelId, '112');
    room.lapsedPair = await createRoom(hotelId, '113');
    room.paid = await createRoom(hotelId, '114');
    room.running = await createRoom(hotelId, '115');
    room.gone = await createRoom(hotelId, '116');
    room.plain = await createRoom(plainHotelId, '201');
    room.closed = await createRoom(closedHotelId, '301');

    const blocked = await roomNights.create({
      roomId: new Types.ObjectId(room.blocked),
      hotelId: new Types.ObjectId(hotelId),
      date: day(21),
      state: RoomNightState.Blocked,
    });
    createdNightIds.push(blocked._id.toString());

    // A night of a Confirmed reservation of someone else (HTL-17 turns the
    // held nights of a paid reservation into booked ones).
    const booked = await roomNights.create({
      roomId: new Types.ObjectId(room.booked),
      hotelId: new Types.ObjectId(hotelId),
      date: day(26),
      state: RoomNightState.Booked,
      bookingId: new Types.ObjectId(),
    });
    createdNightIds.push(booked._id.toString());

    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['user', Role.User, undefined],
      ['other', Role.User, undefined],
      ['admin', Role.Admin, undefined],
      ['moderator', Role.HotelModerator, new Types.ObjectId(hotelId)],
      ...[1, 2, 3, 4, 5].map((n): [string, Role, undefined] => [
        `racer${n}`,
        Role.User,
        undefined,
      ]),
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const user = await users.create({
        name: `HTL-16 ${label}`,
        email: `htl16-${label}-${RUN}@example.com`,
        passwordHash: 'not-a-real-hash',
        role,
        consentAcceptedAt: new Date(),
        ...(assignedHotel && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: assignedHotel,
          },
        }),
      });
      const id = user._id.toString();
      createdUserIds.push(id);
      userIds.set(label, id);
      cookies.set(label, await sessionCookieFor(app, id));
    }
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      const own = await bookings
        .find({ userId: new Types.ObjectId(userId) })
        .select('_id')
        .lean()
        .exec();
      for (const { _id } of own) {
        await bookings.findByIdAndDelete(_id);
      }
    }
    for (const id of createdRoomIds) {
      for (const { _id } of await nightsOfRoom(id)) {
        await roomNights.findByIdAndDelete(_id);
      }
    }
    for (const id of createdNightIds) {
      await roomNights.findByIdAndDelete(id);
    }
    for (const id of createdRoomIds) {
      await rooms.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('reserves two rooms with their guests and holds them for 10 minutes', async () => {
    const before = Date.now();
    const response = await book('user', {
      hotelId,
      checkIn: day(10),
      checkOut: day(13),
      rooms: [
        { roomId: room.double, adults: 1, childAges: [4] },
        { roomId: room.family, adults: 2, childAges: [9, 12] },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      reference: null,
      hotelId,
      checkIn: day(10),
      checkOut: day(13),
      nights: 3,
      status: 'pending_payment',
      holdExpiresAt: expect.stringMatching(/Z$/),
      currency: 'USD',
      // 3 nights x (12500 + 20000)
      total: 97500,
      rooms: [
        {
          roomId: room.double,
          roomLabel: '101 (Double)',
          pricePerNight: 12500,
          subtotal: 37500,
          adults: 1,
          childAges: [4],
        },
        {
          roomId: room.family,
          roomLabel: '102 (Family)',
          pricePerNight: 20000,
          subtotal: 60000,
          adults: 2,
          childAges: [9, 12],
        },
      ],
      checkInTime: '14:00',
      checkOutTime: '11:00',
      cancellationTiers: [
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
      createdAt: expect.stringMatching(/Z$/),
    });
    const created = response.body as BookingBody;

    const holdMs = Date.parse(created.holdExpiresAt as string) - before;
    expect(holdMs).toBeGreaterThan(9.5 * 60 * 1000);
    expect(holdMs).toBeLessThanOrEqual(10.5 * 60 * 1000);

    // Three nights in each room, all held for this reservation.
    const nights = await nightsOf(created.id);
    expect(nights).toHaveLength(6);
    for (const item of nights) {
      expect(item.state).toBe(RoomNightState.Held);
      expect(item.hotelId.toString()).toBe(hotelId);
      expect(item.holdExpiresAt?.toISOString()).toBe(created.holdExpiresAt);
    }
    expect(nights.map((item) => item.date)).toEqual([
      day(10),
      day(11),
      day(12),
      day(10),
      day(11),
      day(12),
    ]);

    const stored = await bookings.findById(created.id).lean().exec();
    expect(stored?.userId.toString()).toBe(userIds.get('user'));
    expect(stored?.status).toBe(HotelBookingStatus.PendingPayment);
    expect(stored?.reference).toBeUndefined();
    expect(response.body).not.toHaveProperty('userId');
  });

  it('takes the held rooms out of the available rooms (HTL-15)', async () => {
    const available = await request(app.getHttpServer())
      .get(`/api/hotels/${hotelId}/rooms/available`)
      .query({ checkIn: day(12), checkOut: day(14), limit: '50' });

    expect(available.status).toBe(200);
    const numbers = (
      available.body as { items: { number: string }[] }
    ).items.map((item) => item.number);
    expect(numbers).not.toContain('101');
    expect(numbers).not.toContain('102');
    expect(numbers).toContain('103');
  });

  it('refuses the whole request when one room is held, and holds nothing', async () => {
    const response = await book(
      'other',
      body([room.single, room.double], day(11), day(12)),
    );

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).message).toBe(
      'Not free for the whole stay: room 101. Nothing was held.',
    );
    expect(await nightsOfRoom(room.single)).toHaveLength(0);
  });

  it('refuses a room with a blocked night', async () => {
    const response = await book(
      'other',
      body([room.blocked], day(20), day(23)),
    );

    expect(response.status).toBe(409);
    // The moderator's block is still the only night of that room.
    expect(await nightsOfRoom(room.blocked)).toHaveLength(1);
  });

  it('refuses a room with a night of a confirmed reservation, and holds nothing', async () => {
    // The free room comes first: it is not held either (all or nothing).
    const response = await book(
      'other',
      body([room.single, room.booked], day(25), day(28)),
    );

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).message).toBe(
      'Not free for the whole stay: room 110. Nothing was held.',
    );
    expect(await nightsOfRoom(room.single)).not.toContainEqual(
      expect.objectContaining({ date: day(25) }),
    );
    // The booked night is the only night of that room.
    expect(await nightsOfRoom(room.booked)).toHaveLength(1);
  });

  it('refuses the whole request when one room has a blocked night', async () => {
    const response = await book(
      'other',
      body([room.single, room.blocked], day(21), day(22)),
    );

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).message).toBe(
      'Not free for the whole stay: room 105. Nothing was held.',
    );
    expect(await nightsOfRoom(room.single)).not.toContainEqual(
      expect.objectContaining({ date: day(21) }),
    );
  });

  it('holds back-to-back stays: a stay may start on the check-out day of another', async () => {
    const first = await book('user', body([room.adjacent], day(30), day(32)));
    expect(first.status).toBe(201);

    // The check-out day is not a night of the stay, so it is free.
    const next = await book('other', body([room.adjacent], day(32), day(33)));
    expect(next.status).toBe(201);
    const before = await book('other', body([room.adjacent], day(29), day(30)));
    expect(before.status).toBe(201);

    // One more night inside the first stay overlaps it.
    expect(
      (await book('other', body([room.adjacent], day(31), day(32)))).status,
    ).toBe(409);

    const nights = await nightsOfRoom(room.adjacent);
    expect(nights.map((item) => item.date)).toEqual([
      day(29),
      day(30),
      day(31),
      day(32),
    ]);
  });

  it('refuses a deactivated room and a stay outside the availability', async () => {
    expect(
      (await book('other', body([room.inactive], day(30), day(31)))).status,
    ).toBe(409);
    expect(
      (await book('other', body([room.short], day(4), day(6)))).status,
    ).toBe(409);
    expect(await nightsOfRoom(room.inactive)).toHaveLength(0);
    expect(await nightsOfRoom(room.short)).toHaveLength(0);
  });

  it('lets only one of five people who try at the same moment hold a room', async () => {
    const racers = [1, 2, 3, 4, 5].map((n) => `racer${n}`);
    const responses = await Promise.all(
      racers.map((who) => book(who, body([room.race], day(40), day(43)))),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    const winner = responses.find((response) => response.status === 201);
    expect(winner).toBeDefined();
    const winnerBody = winner?.body as BookingBody | undefined;
    const nights = await nightsOfRoom(room.race);
    expect(nights).toHaveLength(3);
    expect(new Set(nights.map((item) => item.bookingId?.toString()))).toEqual(
      new Set([winnerBody?.id]),
    );

    // Only the winner has a reservation.
    const saved = await bookings
      .countDocuments({ 'rooms.roomId': new Types.ObjectId(room.race) })
      .exec();
    expect(saved).toBe(1);
  });

  it('frees the room for someone else when the hold runs out', async () => {
    const first = await book('user', body([room.expiring], day(50), day(52)));
    expect(first.status).toBe(201);

    // The same room for overlapping nights is refused while the hold runs.
    expect(
      (await book('other', body([room.expiring], day(51), day(53)))).status,
    ).toBe(409);

    // The 10 minutes pass.
    for (const item of await nightsOf((first.body as BookingBody).id)) {
      await roomNights.updateOne(
        { _id: item._id },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
    }

    const second = await book('other', body([room.expiring], day(51), day(53)));
    expect(second.status).toBe(201);
    // The expired night 51 was reused; the other night of the first hold is
    // still there, expired, and ignored by every query.
    const nights = await nightsOfRoom(room.expiring);
    expect(nights.map((item) => item.date)).toEqual([
      day(50),
      day(51),
      day(52),
    ]);
    expect(
      nights
        .filter((item) => item.date !== day(50))
        .every(
          (item) =>
            item.bookingId?.toString() === (second.body as BookingBody).id,
        ),
    ).toBe(true);
  });

  it('reuses a night whose hold expired a minute ago', async () => {
    const stale = new Types.ObjectId();
    const night = await roomNights.create({
      roomId: new Types.ObjectId(room.single),
      hotelId: new Types.ObjectId(hotelId),
      date: day(60),
      state: RoomNightState.Held,
      bookingId: stale,
      holdExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    createdNightIds.push(night._id.toString());

    const response = await book('user', body([room.single], day(60), day(61)));

    expect(response.status).toBe(201);
    expect(await nightsOf(stale.toString())).toHaveLength(0);
    expect(await nightsOf((response.body as BookingBody).id)).toHaveLength(1);
  });

  it('copies no times or tiers from a hotel without policies', async () => {
    const response = await book('user', {
      ...body([room.plain], day(10), day(11)),
      hotelId: plainHotelId,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      checkInTime: null,
      checkOutTime: null,
      cancellationTiers: [],
      total: 10000,
    });
  });

  it('keeps the price of the reservation when the room price changes later', async () => {
    const response = await book('user', body([room.priced], day(70), day(72)));
    expect(response.status).toBe(201);

    await rooms.updateOne(
      { _id: new Types.ObjectId(room.priced) },
      { $set: { pricePerNight: 99999 } },
    );

    const stored = await bookings
      .findById((response.body as BookingBody).id)
      .lean()
      .exec();
    expect(stored?.total).toBe(20000);
    expect(stored?.rooms[0].pricePerNight).toBe(10000);
  });

  it('refuses more guests than a room holds', async () => {
    const response = await book('user', {
      ...body([], day(75), day(76)),
      rooms: [{ roomId: room.single, adults: 1, childAges: [3] }],
    });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors).toEqual([
      {
        field: 'rooms',
        messages: ['Too many guests for a room: room 103 holds at most 1'],
      },
    ]);
    expect(await nightsOfRoom(room.single)).not.toContainEqual(
      expect.objectContaining({ date: day(75) }),
    );
  });

  it.each([
    [
      'no adult',
      {
        rooms: [
          { roomId: '6740f1c2a4b5c6d7e8f90456', adults: 0, childAges: [5] },
        ],
      },
      'rooms',
    ],
    [
      'a check-out before check-in',
      { checkIn: day(5), checkOut: day(4) },
      'checkIn',
    ],
    ['a price sent by the client', { total: 1 }, 'total'],
    ['an owner sent by the client', { userId: 'x' }, 'userId'],
    ['a status sent by the client', { status: 'confirmed' }, 'status'],
    ['a hold time sent by the client', { holdExpiresAt: 'x' }, 'holdExpiresAt'],
    ['a reference sent by the client', { reference: 'x' }, 'reference'],
    ['a hotel id that is not an id', { hotelId: 'nile' }, 'hotelId'],
    [
      'the same room twice',
      {
        rooms: [
          { roomId: '6740f1c2a4b5c6d7e8f90456', adults: 1 },
          { roomId: '6740f1c2a4b5c6d7e8f90456', adults: 1 },
        ],
      },
      'rooms',
    ],
    ['no rooms', { rooms: [] }, 'rooms'],
  ])('answers 400 for %s', async (_label, change, field) => {
    const response = await book('user', {
      ...body([room.double], day(80), day(81)),
      ...change,
    });

    expect(response.status).toBe(400);
    expect(
      (response.body as ErrorBody).errors?.map((error) => error.field),
    ).toContain(field);
  });

  it('answers 400 when check-out is not after check-in, and holds nothing', async () => {
    const response = await book('user', body([room.double], day(90), day(90)));

    expect(response.status).toBe(400);
    expect(
      (response.body as ErrorBody).errors?.map((error) => error.field),
    ).toContain('checkIn');
    expect(await nightsOfRoom(room.double)).not.toContainEqual(
      expect.objectContaining({ date: day(90) }),
    );
  });

  it('answers 400 for a check-in in the past, and for a stay of more than 366 nights', async () => {
    const past = await book('user', body([room.double], day(-1), day(1)));
    expect(past.status).toBe(400);
    expect((past.body as ErrorBody).errors?.[0].field).toBe('checkIn');

    const long = await book('user', body([room.double], day(1), day(400)));
    expect(long.status).toBe(400);
    expect((long.body as ErrorBody).errors?.[0].field).toBe('checkOut');
  });

  it('answers 404 for a deactivated hotel and for a room of another hotel', async () => {
    expect(
      (
        await book('user', {
          ...body([room.closed], day(10), day(11)),
          hotelId: closedHotelId,
        })
      ).status,
    ).toBe(404);
    expect(
      (await book('user', body([room.plain], day(10), day(11)))).status,
    ).toBe(404);
    expect(
      (
        await book('user', {
          ...body([room.double], day(10), day(11)),
          hotelId: new Types.ObjectId().toString(),
        })
      ).status,
    ).toBe(404);
  });

  it('is for registered users only: 401 for a guest, 403 for an administrator and a moderator', async () => {
    const stay = body([room.double], day(85), day(86));

    expect((await book(undefined, stay)).status).toBe(401);
    expect((await book('admin', stay)).status).toBe(403);
    expect((await book('moderator', stay)).status).toBe(403);
    expect(await nightsOfRoom(room.double)).not.toContainEqual(
      expect.objectContaining({ date: day(85) }),
    );
  });

  describe('expiry of unpaid holds (HTL-18, GEN-11)', () => {
    /** The 10 minutes of a reservation pass: its hold and its nights end. */
    const endHold = async (bookingId: string) => {
      const ended = new Date(Date.now() - 1000);
      await bookings.updateOne(
        { _id: new Types.ObjectId(bookingId) },
        { $set: { holdExpiresAt: ended } },
      );
      for (const item of await nightsOf(bookingId)) {
        await roomNights.updateOne(
          { _id: item._id },
          { $set: { holdExpiresAt: ended } },
        );
      }
    };

    const statusOf = async (bookingId: string) =>
      (await bookings.findById(bookingId).lean().exec())?.status;

    it('expires a reservation whose hold ended and releases all its rooms, exactly once', async () => {
      const held = await book(
        'user',
        body([room.lapsed, room.lapsedPair], day(100), day(103)),
      );
      expect(held.status).toBe(201);
      const id = (held.body as BookingBody).id;
      expect(await nightsOf(id)).toHaveLength(6);
      await endHold(id);

      const expiry = app.get(HotelBookingExpiryService);
      await expiry.expireDueHolds(new Date());

      expect(await statusOf(id)).toBe(HotelBookingStatus.Expired);
      expect(await nightsOf(id)).toHaveLength(0);
      expect(await nightsOfRoom(room.lapsed)).toHaveLength(0);
      expect(await nightsOfRoom(room.lapsedPair)).toHaveLength(0);

      // A second run finds nothing of it to expire or release.
      await expiry.expireDueHolds(new Date());
      expect(await statusOf(id)).toBe(HotelBookingStatus.Expired);

      // The rooms are free again for the same dates, for someone else.
      const again = await book(
        'other',
        body([room.lapsed, room.lapsedPair], day(100), day(103)),
      );
      expect(again.status).toBe(201);
      expect(await nightsOf((again.body as BookingBody).id)).toHaveLength(6);
      // The expired reservation stays expired: it is never revived.
      expect(await statusOf(id)).toBe(HotelBookingStatus.Expired);
    });

    it('keeps a room of an expired reservation from being deleted (HTL-06)', async () => {
      const held = await book('user', body([room.gone], day(117), day(118)));
      expect(held.status).toBe(201);
      const id = (held.body as BookingBody).id;
      await endHold(id);
      await app.get(HotelBookingExpiryService).expireDueHolds(new Date());
      // The nights are released: only the reservation still names the room.
      expect(await statusOf(id)).toBe(HotelBookingStatus.Expired);
      expect(await nightsOfRoom(room.gone)).toHaveLength(0);

      const response = await request(app.getHttpServer())
        .delete(`/api/hotels/${hotelId}/rooms/${room.gone}`)
        .set('Cookie', cookies.get('moderator') ?? '');

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).message).toBe(
        'A room that has been reserved cannot be deleted. Deactivate it instead.',
      );
      expect(await rooms.exists({ _id: room.gone })).not.toBeNull();
    });

    it('never expires or releases a reservation confirmed before the job ran', async () => {
      const held = await book('user', body([room.paid], day(110), day(112)));
      expect(held.status).toBe(201);
      const id = (held.body as BookingBody).id;
      await endHold(id);
      // HTL-17 confirms it: the status changes and its nights become booked.
      await bookings.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { status: HotelBookingStatus.Confirmed } },
      );
      for (const item of await nightsOf(id)) {
        await roomNights.updateOne(
          { _id: item._id },
          {
            $set: { state: RoomNightState.Booked },
            $unset: { holdExpiresAt: 1 },
          },
        );
      }

      await app.get(HotelBookingExpiryService).expireDueHolds(new Date());

      expect(await statusOf(id)).toBe(HotelBookingStatus.Confirmed);
      const nights = await nightsOf(id);
      expect(nights).toHaveLength(2);
      expect(nights.every((item) => item.state === RoomNightState.Booked)).toBe(
        true,
      );
    });

    it('leaves a hold that has not ended untouched', async () => {
      const held = await book('user', body([room.running], day(115), day(116)));
      expect(held.status).toBe(201);
      const id = (held.body as BookingBody).id;

      await app.get(HotelBookingExpiryService).expireDueHolds(new Date());

      expect(await statusOf(id)).toBe(HotelBookingStatus.PendingPayment);
      expect(await nightsOf(id)).toHaveLength(1);
      expect(
        (await book('other', body([room.running], day(115), day(116)))).status,
      ).toBe(409);
    });

    it('runs as a scheduled job every minute, without failing', async () => {
      const held = await book('user', body([room.running], day(118), day(119)));
      expect(held.status).toBe(201);
      const id = (held.body as BookingBody).id;
      await endHold(id);

      await expect(
        app.get(HotelBookingExpiryService).expireDueHoldsJob(),
      ).resolves.toBeUndefined();

      expect(await statusOf(id)).toBe(HotelBookingStatus.Expired);
      expect(await nightsOf(id)).toHaveLength(0);
    });
  });

  it('is documented in Swagger for logged-in users', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const doc = response.body as {
      paths: Record<
        string,
        {
          post?: {
            tags: string[];
            security?: unknown[];
            responses: Record<string, unknown>;
          };
        }
      >;
    };

    const operation = doc.paths['/api/hotel-bookings']?.post;
    expect(operation).toBeDefined();
    expect(operation?.tags).toContain('hotel-bookings');
    expect(operation?.security).toBeDefined();
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );
  });
});
