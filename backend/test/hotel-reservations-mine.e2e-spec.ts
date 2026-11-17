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
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

/** A date `days` after today (UTC); negative for the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

describe('My hotel reservations (e2e, HTL-20)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdBookingIds: string[] = [];
  const cookies = new Map<string, string>();
  const userIds = new Map<string, string>();

  let hotelId: string;
  const ids: Record<string, string> = {};

  const get = (who: string | undefined, path: string, query = {}) => {
    const call = request(app.getHttpServer())
      .get(`/api/hotel-bookings${path}`)
      .query(query);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((item) => item.id);

  /** A reservation stored directly, in any status, for the given user. */
  const createBooking = async (
    label: string,
    owner: string,
    fields: Partial<HotelBooking>,
  ) => {
    const booking = await bookings.create({
      userId: new Types.ObjectId(userIds.get(owner)),
      hotelId: new Types.ObjectId(hotelId),
      checkIn: day(10),
      checkOut: day(12),
      nights: 2,
      status: HotelBookingStatus.Confirmed,
      currency: 'USD',
      total: 20000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: 10000,
          adults: 2,
          childAges: [6],
        },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      policyAcceptedAt: new Date(),
      ...fields,
    });
    const id = booking._id.toString();
    createdBookingIds.push(id);
    ids[label] = id;
  };

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
    bookings = app.get<Model<HotelBooking>>(getModelToken(HotelBooking.name));

    const hotel = await hotels.create({
      name: `HTL-20 hotel ${RUN}`,
      addressLine: '20 Nile Street',
      cityId: 'htl20-test-city',
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-20 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    hotelId = hotel._id.toString();
    createdHotelIds.push(hotelId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['user', Role.User, undefined],
      ['other', Role.User, undefined],
      ['moderator', Role.HotelModerator, hotel._id],
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl20-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-20 ${label}`,
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
      userIds.set(label, user._id.toString());

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

    const inTenMinutes = new Date(Date.now() + 10 * 60 * 1000);
    const aMinuteAgo = new Date(Date.now() - 60 * 1000);
    await createBooking('soon', 'user', { checkIn: day(5), checkOut: day(7) });
    await createBooking('later', 'user', {
      checkIn: day(30),
      checkOut: day(32),
    });
    await createBooking('staying', 'user', {
      checkIn: day(-1),
      checkOut: day(0),
    });
    await createBooking('waiting', 'user', {
      checkIn: day(20),
      checkOut: day(21),
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: inTenMinutes,
    });
    await createBooking('lapsed', 'user', {
      checkIn: day(22),
      checkOut: day(23),
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: aMinuteAgo,
    });
    await createBooking('expired', 'user', {
      status: HotelBookingStatus.Expired,
      holdExpiresAt: aMinuteAgo,
    });
    await createBooking('finished', 'user', {
      checkIn: day(-10),
      checkOut: day(-8),
      status: HotelBookingStatus.Completed,
    });
    await createBooking('ended', 'user', {
      checkIn: day(-5),
      checkOut: day(-1),
    });
    await createBooking('cancelled', 'user', {
      checkIn: day(40),
      checkOut: day(41),
      status: HotelBookingStatus.Cancelled,
    });
    await createBooking('others', 'other', {
      checkIn: day(6),
      checkOut: day(8),
    });
  });

  afterAll(async () => {
    for (const id of createdBookingIds) {
      await bookings.findByIdAndDelete(id);
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

  it("lists upcoming stays soonest first, with a live unpaid one, never another user's", async () => {
    const response = await get('user', '', { group: 'upcoming' });

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([
      ids.staying,
      ids.soon,
      ids.waiting,
      ids.later,
    ]);
    expect(response.body.meta.total).toBe(4);
  });

  it('lists past stays latest first', async () => {
    const response = await get('user', '', { group: 'past' });

    expect(idsOf(response.body)).toEqual([ids.ended, ids.finished]);
  });

  it('lists cancelled reservations', async () => {
    const response = await get('user', '', { group: 'cancelled' });

    expect(idsOf(response.body)).toEqual([ids.cancelled]);
  });

  it('lists every reservation of the user without a group, newest first', async () => {
    const response = await get('user', '');

    expect(response.body.meta.total).toBe(9);
    expect(idsOf(response.body)).toEqual(
      [
        'cancelled',
        'ended',
        'finished',
        'expired',
        'lapsed',
        'waiting',
        'staying',
        'later',
        'soon',
      ].map((label) => ids[label]),
    );
    expect(idsOf(response.body)).not.toContain(ids.others);
  });

  it('shows the reference, hotel, rooms, dates, guests, total and status', async () => {
    const response = await get('user', '', { group: 'cancelled' });

    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        id: ids.cancelled,
        reference: null,
        hotelId,
        hotelName: `HTL-20 hotel ${RUN}`,
        checkIn: day(40),
        checkOut: day(41),
        status: 'cancelled',
        total: 20000,
        currency: 'USD',
        rooms: [
          expect.objectContaining({
            roomLabel: '101 (Double)',
            adults: 2,
            childAges: [6],
          }),
        ],
      }),
    );
    expect(response.body.items[0]).not.toHaveProperty('userId');
  });

  it('pages through the list', async () => {
    const response = await get('user', '', { page: '2', limit: '4' });

    expect(response.body.meta).toEqual({
      page: 2,
      limit: 4,
      total: 9,
      totalPages: 3,
    });
    expect(response.body.items).toHaveLength(4);
  });

  it('opens the full details of an own reservation', async () => {
    const response = await get('user', `/${ids.soon}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: ids.soon,
        hotelName: `HTL-20 hotel ${RUN}`,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        policyAcceptedAt: expect.stringMatching(/Z$/),
      }),
    );
  });

  it("answers 403 for someone else's reservation", async () => {
    const response = await get('other', `/${ids.soon}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      'You can only view your own reservations',
    );
  });

  it('answers 404 for a reservation that does not exist, and 400 for a bad id', async () => {
    expect(
      (await get('user', `/${new Types.ObjectId().toString()}`)).status,
    ).toBe(404);
    expect((await get('user', '/not-an-id')).status).toBe(400);
  });

  it('answers 400 for an unknown group', async () => {
    expect((await get('user', '', { group: 'expired' })).status).toBe(400);
  });

  it('is for registered users only', async () => {
    expect((await get(undefined, '')).status).toBe(401);
    expect((await get(undefined, `/${ids.soon}`)).status).toBe(401);
    expect((await get('moderator', '')).status).toBe(403);
    expect((await get('moderator', `/${ids.soon}`)).status).toBe(403);
  });
});
