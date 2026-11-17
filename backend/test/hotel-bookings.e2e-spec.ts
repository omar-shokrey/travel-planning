import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingExpiryService } from './../src/hotel-bookings/hotel-booking-expiry.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

/** A date `days` after today (UTC), so the test never falls in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

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
  const cookies = new Map<string, string>();

  let hotelId: string;
  let plainHotelId: string;
  let closedHotelId: string;
  const room: Record<string, string> = {};

  const book = (who: string | undefined, body: Record<string, unknown>) => {
    const call = request(app.getHttpServer())
      .post('/api/hotel-bookings')
      .send(body);
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
    acceptPolicies: true,
    ...fields,
  });

  const createHotel = async (label: string, fields: Partial<Hotel> = {}) => {
    const hotel = await hotels.create({
      name: `HTL-16 ${label} hotel ${RUN}`,
      addressLine: '16 Nile Street',
      cityId: 'htl16-test-city',
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
      availability: [{ from: day(0), to: day(90) }],
      ...fields,
    });
    const id = created._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  const heldNightsOf = (bookingId: string) =>
    roomNights
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ roomId: 1, date: 1 })
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
    room.plain = await createRoom(plainHotelId, '201');
    room.closed = await createRoom(closedHotelId, '301');

    await roomNights.create({
      roomId: new Types.ObjectId(room.blocked),
      hotelId: new Types.ObjectId(hotelId),
      date: day(21),
      state: RoomNightState.Blocked,
    });

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['user', Role.User, undefined],
      ['other', Role.User, undefined],
      ['moderator', Role.HotelModerator, new Types.ObjectId(hotelId)],
      ...[1, 2, 3, 4, 5].map((n): [string, Role, undefined] => [
        `racer${n}`,
        Role.User,
        undefined,
      ]),
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl16-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-16 ${label}`,
        email,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(assignedHotel && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: assignedHotel,
          },
        }),
      });
      createdUserIds.push(user._id.toString());

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const header = login.headers['set-cookie'] as unknown as string[];
      const accessCookie = header
        .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
        ?.split(';')[0];
      expect(accessCookie).toBeDefined();
      cookies.set(label, accessCookie!);
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
      await roomNights.deleteMany({ roomId: new Types.ObjectId(id) });
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
      acceptPolicies: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      reference: null,
      hotelId,
      hotelName: `HTL-16 main hotel ${RUN}`,
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
      policyAcceptedAt: expect.stringMatching(/Z$/),
      createdAt: expect.stringMatching(/Z$/),
    });

    const holdMs = Date.parse(response.body.holdExpiresAt) - before;
    expect(holdMs).toBeGreaterThan(9.5 * 60 * 1000);
    expect(holdMs).toBeLessThanOrEqual(10.5 * 60 * 1000);

    // Three nights in each room, all held for this reservation.
    const nights = await heldNightsOf(response.body.id);
    expect(nights).toHaveLength(6);
    for (const night of nights) {
      expect(night.state).toBe(RoomNightState.Held);
      expect(night.holdExpiresAt?.toISOString()).toBe(
        response.body.holdExpiresAt,
      );
    }

    const stored = await bookings.findById(response.body.id).lean().exec();
    expect(stored?.userId.toString()).toBe(createdUserIds[0]);
  });

  it('takes the held rooms out of the available rooms and the search (HTL-15, HTL-11)', async () => {
    const available = await request(app.getHttpServer())
      .get(`/api/hotels/${hotelId}/rooms/available`)
      .query({ checkIn: day(12), checkOut: day(14), limit: '50' });

    expect(available.status).toBe(200);
    const numbers = available.body.items.map(
      (item: { number: string }) => item.number,
    );
    expect(numbers).not.toContain('101');
    expect(numbers).not.toContain('102');
  });

  it('refuses the whole request when one room is held, and holds nothing', async () => {
    const response = await book(
      'other',
      body([room.single, room.double], day(11), day(12)),
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Not free for the whole stay: room 101. Nothing was held.',
    );
    const single = await roomNights
      .countDocuments({ roomId: new Types.ObjectId(room.single) })
      .exec();
    expect(single).toBe(0);
  });

  it('refuses a room with a blocked night', async () => {
    const response = await book(
      'other',
      body([room.blocked], day(20), day(23)),
    );

    expect(response.status).toBe(409);
  });

  it('refuses a deactivated room and a stay outside the availability', async () => {
    expect(
      (await book('other', body([room.inactive], day(30), day(31)))).status,
    ).toBe(409);
    expect(
      (await book('other', body([room.short], day(4), day(6)))).status,
    ).toBe(409);
  });

  it('lets only one of five people who try at the same moment hold a room', async () => {
    const racers = [1, 2, 3, 4, 5].map((n) => `racer${n}`);
    const responses = await Promise.all(
      racers.map((who) => book(who, body([room.race], day(40), day(43)))),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    const nights = await roomNights
      .find({ roomId: new Types.ObjectId(room.race) })
      .lean()
      .exec();
    const winner = responses.find((response) => response.status === 201);
    expect(nights).toHaveLength(3);
    expect(new Set(nights.map((night) => night.bookingId?.toString()))).toEqual(
      new Set([winner?.body.id]),
    );

    // Only the winner has a reservation.
    const saved = await bookings
      .countDocuments({ 'rooms.roomId': new Types.ObjectId(room.race) })
      .exec();
    expect(saved).toBe(1);
  });

  it('expires an unpaid reservation and frees its rooms (HTL-18, GEN-11)', async () => {
    const first = await book('user', body([room.expiring], day(50), day(52)));
    expect(first.status).toBe(201);

    // The same room for the same nights is refused while the hold runs.
    expect(
      (await book('other', body([room.expiring], day(51), day(53)))).status,
    ).toBe(409);

    // The 10 minutes pass.
    await bookings
      .updateOne(
        { _id: new Types.ObjectId(first.body.id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      )
      .exec();
    await roomNights
      .updateMany(
        { bookingId: new Types.ObjectId(first.body.id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      )
      .exec();

    await app.get(HotelBookingExpiryService).expireHolds(new Date());

    const expired = await bookings.findById(first.body.id).lean().exec();
    expect(expired?.status).toBe(HotelBookingStatus.Expired);
    expect(await heldNightsOf(first.body.id)).toHaveLength(0);

    const second = await book('other', body([room.expiring], day(51), day(53)));
    expect(second.status).toBe(201);
  });

  it('reuses a night whose hold expired before the job ran', async () => {
    const stale = new Types.ObjectId();
    await roomNights.create({
      roomId: new Types.ObjectId(room.single),
      hotelId: new Types.ObjectId(hotelId),
      date: day(60),
      state: RoomNightState.Held,
      bookingId: stale,
      holdExpiresAt: new Date(Date.now() - 60 * 1000),
    });

    const response = await book('user', body([room.single], day(60), day(61)));

    expect(response.status).toBe(201);
    expect(await heldNightsOf(stale.toString())).toHaveLength(0);
    expect(await heldNightsOf(response.body.id)).toHaveLength(1);
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

  it('refuses more guests than a room holds', async () => {
    const response = await book('user', {
      ...body([], day(70), day(71)),
      rooms: [{ roomId: room.single, adults: 1, childAges: [3] }],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'Too many guests for a room: room 103 holds at most 1',
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
    ],
    ['policies not accepted', { acceptPolicies: false }],
    ['a check-out before check-in', { checkIn: day(5), checkOut: day(4) }],
    ['a price sent by the client', { total: 1 }],
  ])('answers 400 for %s', async (_, change) => {
    const response = await book('user', {
      ...body([room.double], day(80), day(81)),
      ...change,
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
  });

  it('answers 400 for a check-in in the past', async () => {
    const response = await book('user', body([room.double], day(-1), day(1)));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'The check-in date cannot be in the past',
    );
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
  });

  it('is for registered users only', async () => {
    const stay = body([room.double], day(85), day(86));

    expect((await book(undefined, stay)).status).toBe(401);
    expect((await book('moderator', stay)).status).toBe(403);
  });
});
