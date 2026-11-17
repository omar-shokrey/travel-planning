import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
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

describe("A hotel's reservations for its moderator (e2e, HTL-22)", () => {
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
  let otherHotelId: string;
  const ids: Record<string, string> = {};

  const list = (
    who: string | undefined,
    query: Record<string, string> = {},
    hotel = () => hotelId,
  ) => {
    const call = request(app.getHttpServer())
      .get(`/api/hotels/${hotel()}/reservations`)
      .query(query);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((item) => item.id);

  const createBooking = async (
    label: string,
    guest: string,
    hotel: string,
    fields: Partial<HotelBooking>,
  ) => {
    const booking = await bookings.create({
      userId: new Types.ObjectId(userIds.get(guest)),
      hotelId: new Types.ObjectId(hotel),
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
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
      cancellationTiers: [],
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

    const hotel = (label: string) => ({
      name: `HTL-22 ${label} hotel ${RUN}`,
      addressLine: '22 Nile Street',
      cityId: 'htl22-test-city',
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-22 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    const [managed, other] = await hotels.insertMany([
      hotel('managed'),
      hotel('other'),
    ]);
    hotelId = managed._id.toString();
    otherHotelId = other._id.toString();
    createdHotelIds.push(hotelId, otherHotelId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['moderator', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, other._id],
      ['sara', Role.User, undefined],
      ['omar', Role.User, undefined],
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl22-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-22 ${label}`,
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

    await createBooking('december', 'sara', hotelId, {
      reference: `HTL22-${RUN}`,
    });
    await createBooking('january', 'omar', hotelId, {
      checkIn: '2027-01-05',
      checkOut: '2027-01-08',
      nights: 3,
    });
    await createBooking('november', 'sara', hotelId, {
      checkIn: '2026-11-20',
      checkOut: '2026-11-21',
      nights: 1,
      status: HotelBookingStatus.Cancelled,
    });
    await createBooking('waiting', 'omar', hotelId, {
      checkIn: '2026-12-20',
      checkOut: '2026-12-21',
      nights: 1,
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await createBooking('expired', 'omar', hotelId, {
      checkIn: '2026-12-25',
      checkOut: '2026-12-26',
      nights: 1,
      status: HotelBookingStatus.Expired,
    });
    await createBooking('elsewhere', 'sara', otherHotelId, {});
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

  it('lists the reservations of the hotel, latest check-in first, without expired holds', async () => {
    const response = await list('moderator');

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([
      ids.january,
      ids.waiting,
      ids.december,
      ids.november,
    ]);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 4,
      totalPages: 1,
    });
  });

  it('shows the guest, the dates, the rooms and the status, and nothing private', async () => {
    const response = await list('moderator');
    const december = response.body.items.find(
      (item: { id: string }) => item.id === ids.december,
    );

    expect(december).toEqual({
      id: ids.december,
      reference: `HTL22-${RUN}`,
      guestName: 'HTL-22 sara',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      nights: 2,
      status: 'confirmed',
      rooms: [
        {
          roomId: expect.any(String),
          roomLabel: '101 (Double)',
          adults: 2,
          childAges: [6],
        },
      ],
      total: 20000,
      currency: 'USD',
      createdAt: expect.stringMatching(/Z$/),
    });
  });

  it('keeps one status when asked, expired included', async () => {
    const cancelled = await list('moderator', { status: 'cancelled' });
    const expired = await list('moderator', { status: 'expired' });

    expect(idsOf(cancelled.body)).toEqual([ids.november]);
    expect(idsOf(expired.body)).toEqual([ids.expired]);
  });

  it('pages through the list', async () => {
    const response = await list('moderator', { page: '2', limit: '3' });

    expect(idsOf(response.body)).toEqual([ids.november]);
    expect(response.body.meta.totalPages).toBe(2);
  });

  it("never shows another hotel's reservations", async () => {
    const response = await list('otherModerator', {}, () => otherHotelId);

    expect(idsOf(response.body)).toEqual([ids.elsewhere]);
  });

  it('answers 403 to the moderator of another hotel and to a user', async () => {
    expect((await list('otherModerator')).status).toBe(403);
    expect((await list('sara')).status).toBe(403);
  });

  it('answers 401 to a guest', async () => {
    expect((await list(undefined)).status).toBe(401);
  });

  it('answers 404 for a missing hotel and 400 for a bad id or status', async () => {
    expect(
      (await list('moderator', {}, () => new Types.ObjectId().toString()))
        .status,
    ).toBe(404);
    expect((await list('moderator', {}, () => 'nile')).status).toBe(400);
    expect((await list('moderator', { status: 'paid' })).status).toBe(400);
  });
});
