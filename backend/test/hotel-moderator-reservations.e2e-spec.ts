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
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `htl22-${randomUUID().slice(0, 8)}`;

/** A date `days` after today (UTC); negative for the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface ListBody {
  items: {
    id: string;
    reference: string | null;
    guest: { name: string | null };
    checkIn: string;
    checkOut: string;
    nights: number;
    rooms: { roomLabel: string; adults: number; childAges: number[] }[];
    status: string;
    createdAt: string;
  }[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * HTL-22 end to end, on the "-test" database: the reservations are inserted
 * with the model in each status, for two hotels. Every record is deleted by id.
 */
describe('Moderator hotel reservations (e2e, HTL-22)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  const userIds: string[] = [];
  const hotelIds: string[] = [];
  const bookingIds: string[] = [];
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const emails = new Map<string, string>();
  let hotelA: string;
  let hotelB: string;
  let counter = 0;

  const http = () => request(app.getHttpServer());

  const list = (hotelId: string, query = '', who = 'moderatorA') => {
    const call = http().get(`/api/hotels/${hotelId}/reservations${query}`);
    const cookie = cookies.get(who);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const createActor = async (
    label: string,
    role: Role,
    hotelId?: string,
    name = `${RUN} ${label}`,
  ) => {
    const email = `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.com`;
    const created = await users.create({
      name,
      email,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(hotelId && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(hotelId),
        },
      }),
    });
    const id = created._id.toString();
    userIds.push(id);
    emails.set(label, email);
    cookies.set(label, await sessionCookieFor(app, id));
    return id;
  };

  const createHotel = async (name: string) => {
    const hotel = await hotels.create({
      name: `${name} ${RUN}`,
      addressLine: '22 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-22 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    const id = hotel._id.toString();
    hotelIds.push(id);
    return id;
  };

  const insert = async (
    label: string,
    guest: string,
    hotelId: string,
    status: HotelBookingStatus,
    checkIn: string,
  ) => {
    const booking = await bookings.create({
      reference: `HB-M${RUN.slice(-6).toUpperCase()}${++counter}`,
      userId: new Types.ObjectId(guest),
      hotelId: new Types.ObjectId(hotelId),
      checkIn,
      checkOut: DateTime.fromISO(checkIn)
        .plus({ days: 2 })
        .toISODate() as string,
      nights: 2,
      status,
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      policyAcceptedAt: new Date(),
      currency: 'USD',
      total: 45000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '301 (Double)',
          pricePerNight: 22500,
          adults: 2,
          childAges: [5],
        },
      ],
      cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    });
    const id = booking._id.toString();
    bookingIds.push(id);
    ids.set(label, id);
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
    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    bookings = app.get<Model<HotelBooking>>(getModelToken(HotelBooking.name));

    hotelA = await createHotel('HTL-22 A');
    hotelB = await createHotel('HTL-22 B');
    await createActor('moderatorA', Role.HotelModerator, hotelA);
    await createActor('moderatorB', Role.HotelModerator, hotelB);
    await createActor('airlineModerator', Role.AirlineModerator);
    await createActor('admin', Role.Admin);
    await createActor('user', Role.User);
    const sara = await createActor('sara', Role.User, undefined, 'Sara HTL22');
    const omar = await createActor('omar', Role.User, undefined, 'Omar HTL22');

    await insert(
      'confirmedSoon',
      sara,
      hotelA,
      HotelBookingStatus.Confirmed,
      day(5),
    );
    await insert(
      'confirmedLater',
      omar,
      hotelA,
      HotelBookingStatus.Confirmed,
      day(30),
    );
    await insert(
      'completed',
      sara,
      hotelA,
      HotelBookingStatus.Completed,
      day(-20),
    );
    await insert(
      'cancelled',
      omar,
      hotelA,
      HotelBookingStatus.Cancelled,
      day(15),
    );
    await insert(
      'pending',
      sara,
      hotelA,
      HotelBookingStatus.PendingPayment,
      day(40),
    );
    await insert('expired', sara, hotelA, HotelBookingStatus.Expired, day(45));
    await insert(
      'otherHotel',
      sara,
      hotelB,
      HotelBookingStatus.Confirmed,
      day(10),
    );
  });

  afterAll(async () => {
    if (!app) return;
    for (const id of bookingIds) {
      await bookings.findByIdAndDelete(id).exec();
    }
    for (const id of hotelIds) {
      await hotels.findByIdAndDelete(id).exec();
    }
    for (const id of userIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id).exec();
    }
    await app.close();
  });

  const idsOf = (body: ListBody) => body.items.map((item) => item.id);
  const labelled = (...labels: string[]) => labels.map((l) => ids.get(l));

  it("lists only its own hotel's confirmed, completed and cancelled reservations, newest check-in first", async () => {
    const response = await list(hotelA);

    expect(response.status).toBe(200);
    const body = response.body as ListBody;
    expect(idsOf(body)).toEqual(
      labelled('confirmedLater', 'cancelled', 'confirmedSoon', 'completed'),
    );
    expect(body.meta).toEqual({ page: 1, limit: 10, total: 4, totalPages: 1 });
  });

  it('shows the guest name, the dates, the rooms, the status and the reference', async () => {
    const body = (await list(hotelA, '?status=cancelled')).body as ListBody;

    expect(body.items).toEqual([
      {
        id: ids.get('cancelled'),
        reference: expect.stringMatching(/^HB-M/),
        guest: { name: 'Omar HTL22' },
        checkIn: day(15),
        checkOut: day(17),
        nights: 2,
        rooms: [{ roomLabel: '301 (Double)', adults: 2, childAges: [5] }],
        status: HotelBookingStatus.Cancelled,
        createdAt: expect.stringMatching(/Z$/),
      },
    ]);
  });

  it('leaks nothing a moderator does not need: no email, account id, price, payment or hold', async () => {
    // The items only: the page `meta` has its own `total` (the count).
    const text = JSON.stringify(((await list(hotelA)).body as ListBody).items);

    for (const secret of [
      emails.get('sara') ?? '',
      emails.get('omar') ?? '',
      'userId',
      'total',
      'currency',
      'pricePerNight',
      'holdExpiresAt',
      'policyAcceptedAt',
      'cancellationTiers',
      'roomId',
      '__v',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ['confirmed', ['confirmedLater', 'confirmedSoon']],
    ['completed', ['completed']],
    ['cancelled', ['cancelled']],
  ])('filters on status=%s', async (status, labels) => {
    const body = (await list(hotelA, `?status=${status}`)).body as ListBody;

    expect(idsOf(body)).toEqual(labelled(...labels));
  });

  it('pages the list without repeating or skipping a reservation', async () => {
    const first = (await list(hotelA, '?limit=3&page=1')).body as ListBody;
    const second = (await list(hotelA, '?limit=3&page=2')).body as ListBody;

    expect(first.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect([...idsOf(first), ...idsOf(second)]).toEqual(
      idsOf((await list(hotelA)).body as ListBody),
    );
  });

  it("refuses another hotel's moderator with 403, both ways", async () => {
    expect((await list(hotelA, '', 'moderatorB')).status).toBe(403);
    expect((await list(hotelB, '', 'moderatorA')).status).toBe(403);
  });

  it('refuses every other role with 403 and a guest with 401', async () => {
    for (const who of ['user', 'admin', 'airlineModerator']) {
      expect((await list(hotelA, '', who)).status).toBe(403);
    }
    expect((await list(hotelA, '', 'guest')).status).toBe(401);
  });

  it('answers 404 for a hotel that does not exist, and 400 for a bad id or query', async () => {
    expect((await list(new Types.ObjectId().toString())).status).toBe(404);
    expect((await list('not-an-id')).status).toBe(400);
    for (const query of [
      '?status=pending_payment',
      '?status=expired',
      '?page=0',
      '?email=x',
    ]) {
      expect((await list(hotelA, query)).status).toBe(400);
    }
  });

  it('is documented in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const route = (
      response.body.paths as Record<
        string,
        Record<string, { responses: Record<string, unknown> }>
      >
    )['/api/hotels/{id}/reservations'];

    expect(Object.keys(route.get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
  });
});
