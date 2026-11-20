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
import { ReservationGroup } from './../src/hotel-bookings/enums/reservation-group.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `htl20-${randomUUID().slice(0, 8)}`;

/** A date `days` after today (UTC); negative for the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface ListBody {
  items: {
    id: string;
    reference: string | null;
    hotel: { id: string; name: string | null };
    rooms: { roomLabel: string; adults: number; childAges: number[] }[];
    checkIn: string;
    checkOut: string;
    guests: { adults: number; children: number };
    total: number;
    status: string;
    group: string;
  }[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * HTL-20 end to end, on the "-test" database: the reservations are inserted
 * with the model in each status, so the test does not depend on the clock of
 * the completion job. Every record is deleted by id.
 */
describe('My hotel reservations (e2e, HTL-20)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let bookings: Model<HotelBooking>;
  let refunds: Model<Refund>;
  const userIds: string[] = [];
  const hotelIds: string[] = [];
  const bookingIds: string[] = [];
  const refundIds: string[] = [];
  const cookies = new Map<string, string>();
  /** The user's reservations by label, and the other user's. */
  const ids = new Map<string, string>();
  let hotelA: string;
  let hotelB: string;
  let counter = 0;

  const http = () => request(app.getHttpServer());

  const list = (query = '', who = 'user') => {
    const call = http().get(`/api/hotel-bookings${query}`);
    const cookie = cookies.get(who);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const details = (id: string, who = 'user') => {
    const call = http().get(`/api/hotel-bookings/${id}`);
    const cookie = cookies.get(who);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const createActor = async (label: string, role: Role) => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(hotelA),
        },
      }),
    });
    const id = created._id.toString();
    userIds.push(id);
    cookies.set(label, await sessionCookieFor(app, id));
    return id;
  };

  const createHotel = async (name: string) => {
    const hotel = await hotels.create({
      name: `${name} ${RUN}`,
      addressLine: '20 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-20 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    const id = hotel._id.toString();
    hotelIds.push(id);
    return id;
  };

  /** A reservation of `owner`, stored with the model in `status`. */
  const insert = async (
    label: string,
    owner: string,
    hotelId: string,
    status: HotelBookingStatus,
    checkIn: string,
    checkOut: string,
  ) => {
    const booking = await bookings.create({
      reference:
        status === HotelBookingStatus.PendingPayment ||
        status === HotelBookingStatus.Expired
          ? undefined
          : `HB-T${RUN.slice(-6).toUpperCase()}${++counter}`,
      userId: new Types.ObjectId(owner),
      hotelId: new Types.ObjectId(hotelId),
      checkIn,
      checkOut,
      nights: 2,
      status,
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      policyAcceptedAt: new Date(),
      currency: 'USD',
      total: 45000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '201 (Double)',
          pricePerNight: 12500,
          adults: 2,
          childAges: [],
        },
        {
          roomId: new Types.ObjectId(),
          roomLabel: '202 (Family)',
          pricePerNight: 10000,
          adults: 1,
          childAges: [6],
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
    refunds = app.get<Model<Refund>>(getModelToken(Refund.name));

    hotelA = await createHotel('HTL-20 Nile');
    hotelB = await createHotel('HTL-20 Sea');
    const user = await createActor('user', Role.User);
    const other = await createActor('other', Role.User);
    await createActor('admin', Role.Admin);
    await createActor('moderator', Role.HotelModerator);

    // The user's reservations, one per case of the grouping rule.
    await insert(
      'upcoming',
      user,
      hotelA,
      HotelBookingStatus.Confirmed,
      day(20),
      day(22),
    );
    await insert(
      'ongoing',
      user,
      hotelB,
      HotelBookingStatus.Confirmed,
      day(-1),
      day(1),
    );
    await insert(
      'pastConfirmed',
      user,
      hotelA,
      HotelBookingStatus.Confirmed,
      day(-5),
      day(-3),
    );
    await insert(
      'completed',
      user,
      hotelB,
      HotelBookingStatus.Completed,
      day(-30),
      day(-28),
    );
    const cancelled = await insert(
      'cancelled',
      user,
      hotelA,
      HotelBookingStatus.Cancelled,
      day(40),
      day(42),
    );
    await insert(
      'pending',
      user,
      hotelA,
      HotelBookingStatus.PendingPayment,
      day(50),
      day(52),
    );
    await insert(
      'expired',
      user,
      hotelA,
      HotelBookingStatus.Expired,
      day(60),
      day(62),
    );
    await insert(
      'othersUpcoming',
      other,
      hotelA,
      HotelBookingStatus.Confirmed,
      day(25),
      day(27),
    );

    // The refund of the cancelled reservation (PAY-03), shown on its details.
    const refund = await refunds.create({
      bookingType: BookingType.Hotel,
      bookingId: new Types.ObjectId(cancelled),
      paymentId: new Types.ObjectId(),
      userId: new Types.ObjectId(user),
      amount: 45000,
      currency: 'USD',
      refundPercent: 100,
      reason: RefundReason.UserCancellation,
      status: RefundStatus.Refunded,
      stripeRefundId: `re_test_${RUN}`,
    });
    refundIds.push(refund._id.toString());
  });

  afterAll(async () => {
    if (!app) return;
    for (const id of refundIds) {
      await refunds.findByIdAndDelete(id).exec();
    }
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
  const labelled = (...labels: string[]) =>
    labels.map((label) => ids.get(label));

  describe('GET /api/hotel-bookings', () => {
    it("lists the user's own reservations of the three groups, with their group, and nothing else", async () => {
      const response = await list();

      expect(response.status).toBe(200);
      const body = response.body as ListBody;
      // Most recent check-in first.
      expect(idsOf(body)).toEqual(
        labelled(
          'cancelled',
          'upcoming',
          'ongoing',
          'pastConfirmed',
          'completed',
        ),
      );
      expect(body.items.map((item) => item.group)).toEqual([
        ReservationGroup.Cancelled,
        ReservationGroup.Upcoming,
        ReservationGroup.Upcoming,
        ReservationGroup.Past,
        ReservationGroup.Past,
      ]);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 5,
        totalPages: 1,
      });
    });

    it('shows the reference, the hotel, the rooms, the dates, the guests, the total and the status, and nothing internal', async () => {
      const body = (await list('?group=upcoming')).body as ListBody;
      const first = body.items.find((item) => item.id === ids.get('upcoming'));

      expect(first).toEqual({
        id: ids.get('upcoming'),
        reference: expect.stringMatching(/^HB-T/),
        hotel: { id: hotelA, name: `HTL-20 Nile ${RUN}` },
        rooms: [
          { roomLabel: '201 (Double)', adults: 2, childAges: [] },
          { roomLabel: '202 (Family)', adults: 1, childAges: [6] },
        ],
        checkIn: day(20),
        checkOut: day(22),
        nights: 2,
        guests: { adults: 3, children: 1 },
        total: 45000,
        currency: 'USD',
        status: HotelBookingStatus.Confirmed,
        group: ReservationGroup.Upcoming,
      });
      const text = JSON.stringify(body);
      for (const field of [
        'holdExpiresAt',
        'policyAcceptedAt',
        'userId',
        '_id',
        '__v',
      ]) {
        expect(text).not.toContain(field);
      }
    });

    it.each([
      [ReservationGroup.Upcoming, ['ongoing', 'upcoming']],
      [ReservationGroup.Past, ['pastConfirmed', 'completed']],
      [ReservationGroup.Cancelled, ['cancelled']],
    ])('lists group=%s only', async (group, labels) => {
      const body = (await list(`?group=${group}`)).body as ListBody;

      expect(idsOf(body)).toEqual(labelled(...labels));
      expect(body.items.every((item) => item.group === group)).toBe(true);
    });

    it('pages the list: no reservation repeated or skipped', async () => {
      const first = (await list('?limit=2&page=1')).body as ListBody;
      const second = (await list('?limit=2&page=2')).body as ListBody;
      const third = (await list('?limit=2&page=3')).body as ListBody;

      expect(first.meta).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect([...idsOf(first), ...idsOf(second), ...idsOf(third)]).toEqual(
        idsOf((await list()).body as ListBody),
      );
      expect(((await list('?limit=2&page=4')).body as ListBody).items).toEqual(
        [],
      );
    });

    it.each(['?group=all', '?group=pending_payment', '?page=0', '?userId=x'])(
      'answers 400 for %s',
      async (query) => {
        expect((await list(query)).status).toBe(400);
      },
    );

    it('answers 401 to a guest and 403 to an admin and a moderator', async () => {
      expect((await list('', 'guest')).status).toBe(401);
      expect((await list('', 'admin')).status).toBe(403);
      expect((await list('', 'moderator')).status).toBe(403);
    });
  });

  describe('GET /api/hotel-bookings/:id', () => {
    it('shows the full details of a cancelled reservation, with its refund and status', async () => {
      const response = await details(ids.get('cancelled') ?? '');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: ids.get('cancelled'),
        hotel: { id: hotelA, name: `HTL-20 Nile ${RUN}` },
        status: HotelBookingStatus.Cancelled,
        group: ReservationGroup.Cancelled,
        checkIn: day(40),
        checkOut: day(42),
        guests: { adults: 3, children: 1 },
        total: 45000,
        cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
        refund: {
          id: refundIds[0],
          status: RefundStatus.Refunded,
          amount: 45000,
          currency: 'USD',
          refundPercent: 100,
        },
      });
      expect(response.body.rooms).toHaveLength(2);
      const text = JSON.stringify(response.body);
      for (const field of [
        'holdExpiresAt',
        'policyAcceptedAt',
        'userId',
        '_id',
        '__v',
      ]) {
        expect(text).not.toContain(field);
      }
    });

    it('shows no refund when there is none, and opens a reservation that waits for payment with no group', async () => {
      const upcoming = await details(ids.get('upcoming') ?? '');
      const pending = await details(ids.get('pending') ?? '');

      expect(upcoming.body.refund).toBeNull();
      expect(pending.status).toBe(200);
      expect(pending.body.group).toBeNull();
      expect(pending.body.reference).toBeNull();
    });

    it("answers 404 for another user's reservation, like one that does not exist", async () => {
      const others = await details(ids.get('othersUpcoming') ?? '');
      const missing = await details(new Types.ObjectId().toString());

      for (const response of [others, missing]) {
        expect(response.status).toBe(404);
        expect(response.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
      }
    });

    it('answers 400 for a bad id, 401 to a guest and 403 to other roles', async () => {
      const id = ids.get('upcoming') ?? '';

      expect((await details('not-an-id')).status).toBe(400);
      expect((await details(id, 'guest')).status).toBe(401);
      expect((await details(id, 'admin')).status).toBe(403);
      expect((await details(id, 'moderator')).status).toBe(403);
    });
  });

  it('documents both routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, { responses: Record<string, unknown> }>
    >;

    expect(Object.keys(paths['/api/hotel-bookings'].get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403']),
    );
    expect(
      Object.keys(paths['/api/hotel-bookings/{id}'].get.responses),
    ).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404']));
  });
});
