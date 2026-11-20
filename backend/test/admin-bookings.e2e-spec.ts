import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { BOOKING_RANGE_ORDER_MESSAGE } from './../src/admin/admin-bookings.constants';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { PLATFORM_CURRENCY } from './../src/common/constants/currency';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from './../src/flight-bookings/enums/passenger-type.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { Airline } from './../src/flights/models/airline.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { Flight } from './../src/flights/models/flight.schema';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const ROUTE = '/api/admin/bookings';
const PASSWORD = 'Passw0rdOK';
const HOUR_MS = 3_600_000;

/**
 * The bookings are made on four days of March 2001, a window no other suite
 * uses, so `from` and `to` isolate them and every total is exact.
 */
const WINDOW = { from: '2001-03-10', to: '2001-03-14' };

/** The access cookie of a login response, ready for a `Cookie` header. */
function accessCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) =>
    candidate.startsWith(`${ACCESS_TOKEN_COOKIE}=`),
  );
  return line?.split(';')[0] ?? '';
}

/** A reference such as `FB-K7Q2XZ`, unique per run. */
const reference = (prefix: string) =>
  `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;

/** The keys of a row: nothing else may be in it. */
const ROW_KEYS = [
  'amount',
  'createdAt',
  'currency',
  'dates',
  'id',
  'providers',
  'reference',
  'status',
  'type',
  'user',
];

interface Row {
  id: string;
  type: string;
  reference: string | null;
  status: string;
  user: { id: string; name: string; email: string | null };
  providers: { type: string; id: string; name: string }[];
  dates: { start: string | null; end: string | null };
  amount: number;
  currency: string;
  createdAt: string;
}

describe('Admin list of all bookings (e2e, ACC-17)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let airlines: Model<Airline>;
  let flights: Model<Flight>;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;

  const RUN = randomUUID();
  const accounts = new Map<string, { id: string; email: string }>();
  const createdUserIds: string[] = [];
  const cookies = new Map<string, string>();

  const airlineA = new Types.ObjectId();
  const airlineB = new Types.ObjectId();
  const hotelId = new Types.ObjectId();
  const airlineAName = `ACC-17 Airline A ${RUN}`;
  const airlineBName = `ACC-17 Airline B ${RUN}`;
  const hotelName = `ACC-17 Hotel ${RUN}`;

  // Three flights far in the future, so no completion job touches them.
  const flight1 = {
    _id: new Types.ObjectId(),
    airlineId: airlineA,
    departureAt: new Date('2030-04-01T08:30:00.000Z'),
    arrivalAt: new Date('2030-04-01T10:45:00.000Z'),
  };
  const flight2 = {
    _id: new Types.ObjectId(),
    airlineId: airlineB,
    departureAt: new Date('2030-04-08T12:00:00.000Z'),
    arrivalAt: new Date('2030-04-08T14:10:00.000Z'),
  };
  const flight3 = {
    _id: new Types.ObjectId(),
    airlineId: airlineA,
    departureAt: new Date('2030-04-20T06:00:00.000Z'),
    arrivalAt: new Date('2030-04-20T09:00:00.000Z'),
  };

  // The seeded bookings, by name. createdAt: the day the booking was made.
  const ids = {
    hotelCompleted: new Types.ObjectId(), // 2001-03-10 00:00:00.000
    flightOneWay: new Types.ObjectId(), // 2001-03-10 23:59:59.999
    flightPending: new Types.ObjectId(), // 2001-03-11 00:00:00.000
    flightRoundTrip: new Types.ObjectId(), // 2001-03-12 12:00
    hotelConfirmed: new Types.ObjectId(), // 2001-03-12 15:00
    flightCancelled: new Types.ObjectId(), // 2001-03-14 09:00
    hotelExpired: new Types.ObjectId(), // 2001-03-14 18:00
  };
  /** Every seeded booking, newest first. */
  const NEWEST_FIRST = [
    ids.hotelExpired,
    ids.flightCancelled,
    ids.hotelConfirmed,
    ids.flightRoundTrip,
    ids.flightPending,
    ids.flightOneWay,
    ids.hotelCompleted,
  ].map((id) => id.toString());
  const references = {
    flightOneWay: reference('FB'),
    flightRoundTrip: reference('FB'),
    flightCancelled: reference('FB'),
    hotelCompleted: reference('HB'),
    hotelConfirmed: reference('HB'),
  };

  const server = () => request(app.getHttpServer());
  const idOf = (label: string) => accounts.get(label)?.id ?? '';

  /** GET the list as `label` (the admin by default), or as a guest with null. */
  const list = (
    query: Record<string, string | number>,
    label: string | null = 'admin',
  ) => {
    const call = server().get(ROUTE).query(query);
    return label ? call.set('Cookie', cookies.get(label) ?? '') : call;
  };
  const inWindow = (query: Record<string, string | number> = {}) =>
    list({ ...WINDOW, limit: 50, ...query });
  const rowIds = (body: { items: Row[] }) => body.items.map((row) => row.id);
  const rowOf = async (id: Types.ObjectId): Promise<Row> => {
    const response = await inWindow();
    expect(response.status).toBe(200);
    const row = (response.body.items as Row[]).find(
      (item) => item.id === id.toString(),
    );
    expect(row).toBeDefined();
    return row as Row;
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
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    flightBookings = app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    hotelBookings = app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    await hotels.insertMany([
      {
        _id: hotelId,
        name: hotelName,
        addressLine: '1 Test Street',
        cityId: 'acc17-city',
        countryCode: 'EG',
        description: 'A hotel created by the ACC-17 e2e test.',
        starClass: 3,
        active: true,
      },
    ]);
    await airlines.insertMany(
      [
        [airlineA, airlineAName],
        [airlineB, airlineBName],
      ].map(([_id, name]) => ({
        _id,
        name,
        code: `Q${randomUUID().slice(0, 6).toUpperCase()}`,
        logo: 'acc17-logo.png',
        active: true,
      })),
    );
    await flights.insertMany(
      [flight1, flight2, flight3].map((flight, index) => ({
        ...flight,
        flightNumber: `ZZ${RUN.slice(0, 4).toUpperCase()}${index}`,
        departureAirport: 'ZZA',
        arrivalAirport: 'ZZB',
        departureDateLocal: flight.departureAt.toISOString().slice(0, 10),
        status: FlightStatus.Scheduled,
        cabins: [],
      })),
    );

    const passwordHash = await hash(PASSWORD, 4);
    const seeds: [string, Role, object | undefined][] = [
      ['admin', Role.Admin, undefined],
      ['userA', Role.User, undefined],
      ['userB', Role.User, undefined],
      [
        'hotelModerator',
        Role.HotelModerator,
        { providerType: ProviderType.Hotel, providerId: hotelId },
      ],
      [
        'airlineModerator',
        Role.AirlineModerator,
        { providerType: ProviderType.Airline, providerId: airlineA },
      ],
    ];
    const inserted = await users.insertMany(
      seeds.map(([label, role, assignment]) => ({
        name: `ACC-17 ${label}`,
        email: `acc17-${label.toLowerCase()}-${RUN}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(assignment && { assignment }),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      accounts.set(seeds[index][0], {
        id: user._id.toString(),
        email: user.email,
      });
    }

    const userA = new Types.ObjectId(idOf('userA'));
    const userB = new Types.ObjectId(idOf('userB'));
    /** A pending booking's hold ends in an hour, so no expiry job runs on it. */
    const hold = () => new Date(Date.now() + HOUR_MS);

    const flightBooking = (
      _id: Types.ObjectId,
      userId: Types.ObjectId,
      status: FlightBookingStatus,
      legs: (typeof flight1)[],
      createdAt: string,
      ref?: string,
    ) => ({
      _id,
      ...(ref && { reference: ref }),
      userId,
      status,
      ...(status === FlightBookingStatus.PendingPayment && {
        holdExpiresAt: hold(),
      }),
      policyAcceptedAt: new Date(createdAt),
      currency: PLATFORM_CURRENCY,
      fareTotal: 20000 * legs.length,
      baggageTotal: 2500,
      total: 20000 * legs.length + 2500,
      segments: legs.map((leg) => ({
        flightId: leg._id,
        airlineId: leg.airlineId,
        cabin: CabinClass.Economy,
        fare: 20000,
        seatsReserved: 1,
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        maxExtraBags: 0,
      })),
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      passengers: [
        {
          fullName: 'ACC-17 Passenger',
          dateOfBirth: '1990-05-14',
          passportNumber: 'ACC17PASS1',
          type: PassengerType.Adult,
          baggage: [],
        },
      ],
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });
    const hotelBooking = (
      _id: Types.ObjectId,
      userId: Types.ObjectId,
      status: HotelBookingStatus,
      checkIn: string,
      checkOut: string,
      createdAt: string,
      ref?: string,
    ) => ({
      _id,
      ...(ref && { reference: ref }),
      userId,
      hotelId,
      checkIn,
      checkOut,
      nights: 2,
      status,
      currency: PLATFORM_CURRENCY,
      total: 30000,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: 15000,
          adults: 2,
          childAges: [],
        },
      ],
      cancellationTiers: [],
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });

    // Through the driver's insertMany (still the "-test" database): the
    // Mongoose timestamps would replace the backdated createdAt.
    await flightBookings.collection.insertMany([
      flightBooking(
        ids.flightOneWay,
        userA,
        FlightBookingStatus.Confirmed,
        [flight1],
        '2001-03-10T23:59:59.999Z',
        references.flightOneWay,
      ),
      flightBooking(
        ids.flightPending,
        userB,
        FlightBookingStatus.PendingPayment,
        [flight3],
        '2001-03-11T00:00:00.000Z',
      ),
      flightBooking(
        ids.flightRoundTrip,
        userA,
        FlightBookingStatus.Confirmed,
        [flight1, flight2],
        '2001-03-12T12:00:00.000Z',
        references.flightRoundTrip,
      ),
      flightBooking(
        ids.flightCancelled,
        userB,
        FlightBookingStatus.Cancelled,
        [flight2],
        '2001-03-14T09:00:00.000Z',
        references.flightCancelled,
      ),
    ]);
    await hotelBookings.collection.insertMany([
      hotelBooking(
        ids.hotelCompleted,
        userA,
        HotelBookingStatus.Completed,
        '2001-03-20',
        '2001-03-22',
        '2001-03-10T00:00:00.000Z',
        references.hotelCompleted,
      ),
      // In the future, so the completion job leaves it confirmed.
      hotelBooking(
        ids.hotelConfirmed,
        userB,
        HotelBookingStatus.Confirmed,
        '2030-05-01',
        '2030-05-03',
        '2001-03-12T15:00:00.000Z',
        references.hotelConfirmed,
      ),
      hotelBooking(
        ids.hotelExpired,
        userB,
        HotelBookingStatus.Expired,
        '2030-06-01',
        '2030-06-03',
        '2001-03-14T18:00:00.000Z',
      ),
    ]);

    for (const [label, account] of accounts) {
      const response = await server()
        .post('/api/auth/login')
        .send({ email: account.email, password: PASSWORD });
      expect(response.status).toBe(200);
      cookies.set(label, accessCookie(response));
    }
  });

  afterAll(async () => {
    for (const id of [
      ids.flightOneWay,
      ids.flightPending,
      ids.flightRoundTrip,
      ids.flightCancelled,
    ]) {
      await flightBookings.findByIdAndDelete(id);
    }
    for (const id of [
      ids.hotelCompleted,
      ids.hotelConfirmed,
      ids.hotelExpired,
    ]) {
      await hotelBookings.findByIdAndDelete(id);
    }
    for (const { _id } of [flight1, flight2, flight3]) {
      await flights.findByIdAndDelete(_id);
    }
    await airlines.findByIdAndDelete(airlineA);
    await airlines.findByIdAndDelete(airlineB);
    await hotels.findByIdAndDelete(hotelId);
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('access', () => {
    it('needs a login', async () => {
      const response = await list(WINDOW, null);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['userA', 'hotelModerator', 'airlineModerator'])(
      'is closed to %s',
      async (label) => {
        const response = await list(WINDOW, label);

        expect(response.status).toBe(403);
        expect(response.body.items).toBeUndefined();
      },
    );

    it('is open to an administrator', async () => {
      expect((await list(WINDOW)).status).toBe(200);
    });
  });

  describe('the default list', () => {
    it('lists both kinds, newest first across both, 10 per page', async () => {
      const response = await list(WINDOW);

      expect(response.status).toBe(200);
      expect(rowIds(response.body)).toEqual(NEWEST_FIRST);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 7,
        totalPages: 1,
      });
      expect(
        new Set((response.body.items as Row[]).map((row) => row.type)),
      ).toEqual(new Set(['flight', 'hotel']));
    });

    it('answers items [] when nothing matches', async () => {
      const response = await list({ from: '2001-03-01', to: '2001-03-02' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('pagination', () => {
    it('walks every page of 2 without repeating or skipping a row', async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 4; page += 1) {
        const response = await list({ ...WINDOW, limit: 2, page });
        expect(response.status).toBe(200);
        expect(response.body.meta).toEqual({
          page,
          limit: 2,
          total: 7,
          totalPages: 4,
        });
        seen.push(...rowIds(response.body));
      }

      expect(seen).toEqual(NEWEST_FIRST);
    });

    it('answers an empty page after the last one', async () => {
      const response = await list({ ...WINDOW, limit: 2, page: 5 });

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.meta.total).toBe(7);
    });

    it.each([
      ['a page size over 50', { limit: 51 }, 'limit'],
      ['page 0', { page: 0 }, 'page'],
    ])('answers 400 for %s', async (_name, query, field) => {
      const response = await list(query);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });
  });

  describe('type filter', () => {
    it('lists only flight bookings with type=flight', async () => {
      const response = await inWindow({ type: 'flight' });

      expect(response.status).toBe(200);
      expect(rowIds(response.body)).toEqual([
        ids.flightCancelled.toString(),
        ids.flightRoundTrip.toString(),
        ids.flightPending.toString(),
        ids.flightOneWay.toString(),
      ]);
      expect(response.body.meta.total).toBe(4);
    });

    it('lists only hotel bookings with type=hotel', async () => {
      const response = await inWindow({ type: 'hotel' });

      expect(response.status).toBe(200);
      expect(rowIds(response.body)).toEqual([
        ids.hotelExpired.toString(),
        ids.hotelConfirmed.toString(),
        ids.hotelCompleted.toString(),
      ]);
    });

    it('answers 400 for a type that does not exist', async () => {
      const response = await list({ type: 'car' });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('type');
    });
  });

  describe('status filter', () => {
    it.each([
      [
        'confirmed',
        [ids.hotelConfirmed, ids.flightRoundTrip, ids.flightOneWay],
      ],
      ['completed', [ids.hotelCompleted]],
      ['pending_payment', [ids.flightPending]],
      ['expired', [ids.hotelExpired]],
      ['cancelled', [ids.flightCancelled]],
    ])('lists only %s bookings', async (status, expected) => {
      const response = await inWindow({ status });

      expect(response.status).toBe(200);
      expect(rowIds(response.body)).toEqual(expected.map(String));
      expect(
        (response.body.items as Row[]).every((row) => row.status === status),
      ).toBe(true);
    });

    it('answers 400 for a status that does not exist', async () => {
      const response = await list({ status: 'paid' });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('status');
    });

    it('needs type and status to match together', async () => {
      const hotel = await inWindow({ type: 'hotel', status: 'confirmed' });
      const none = await inWindow({ type: 'flight', status: 'expired' });

      expect(rowIds(hotel.body)).toEqual([ids.hotelConfirmed.toString()]);
      expect(none.body.items).toEqual([]);
      expect(none.body.meta.total).toBe(0);
    });
  });

  describe('date range (the day the booking was made, UTC)', () => {
    it('keeps the first and the last moment of a day inside from=to=that day', async () => {
      const response = await list({ from: '2001-03-10', to: '2001-03-10' });

      expect(rowIds(response.body)).toEqual([
        ids.flightOneWay.toString(),
        ids.hotelCompleted.toString(),
      ]);
    });

    it('leaves the next day out of to', async () => {
      const response = await list({ from: '2001-03-11', to: '2001-03-11' });

      expect(rowIds(response.body)).toEqual([ids.flightPending.toString()]);
    });

    it('takes to alone', async () => {
      const response = await list({ to: '2001-03-11', limit: 50 });

      expect(response.status).toBe(200);
      expect(rowIds(response.body)).toEqual([
        ids.flightPending.toString(),
        ids.flightOneWay.toString(),
        ids.hotelCompleted.toString(),
      ]);
    });

    it('takes from alone', async () => {
      // Run one after the other: the difference is the bookings of 12 March.
      const from12 = await list({ from: '2001-03-12' });
      const from13 = await list({ from: '2001-03-13' });

      expect(from12.status).toBe(200);
      expect(from12.body.meta.total - from13.body.meta.total).toBe(2);
    });

    it('answers 400 naming from and to when from is after to', async () => {
      const response = await list({ from: '2001-03-12', to: '2001-03-11' });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'from', messages: [BOOKING_RANGE_ORDER_MESSAGE] },
      ]);
      expect(response.body.errors[0].messages[0]).toMatch(/from.*to/);
    });

    it.each([
      ['a day that does not exist', { from: '2026-02-30' }, 'from'],
      ['a time part', { to: '2001-03-10T10:00:00Z' }, 'to'],
    ])('answers 400 for %s', async (_name, query, field) => {
      const response = await list(query);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe(field);
    });
  });

  describe('row content', () => {
    it('shows a one-way flight booking', async () => {
      const row = await rowOf(ids.flightOneWay);

      expect(row).toEqual({
        id: ids.flightOneWay.toString(),
        type: 'flight',
        reference: references.flightOneWay,
        status: 'confirmed',
        user: {
          id: idOf('userA'),
          name: 'ACC-17 userA',
          email: accounts.get('userA')?.email,
        },
        providers: [
          { type: 'airline', id: airlineA.toString(), name: airlineAName },
        ],
        dates: {
          start: '2030-04-01T08:30:00.000Z',
          end: '2030-04-01T10:45:00.000Z',
        },
        amount: 22500,
        currency: 'USD',
        createdAt: '2001-03-10T23:59:59.999Z',
      });
    });

    it('lists both airlines of a round trip once, in the order of its flights', async () => {
      const row = await rowOf(ids.flightRoundTrip);

      expect(row.providers).toEqual([
        { type: 'airline', id: airlineA.toString(), name: airlineAName },
        { type: 'airline', id: airlineB.toString(), name: airlineBName },
      ]);
      expect(row.dates).toEqual({
        start: '2030-04-01T08:30:00.000Z',
        end: '2030-04-08T14:10:00.000Z',
      });
      expect(row.amount).toBe(42500);
    });

    it('gives a pending booking a null reference', async () => {
      const row = await rowOf(ids.flightPending);

      expect(row.reference).toBeNull();
      expect(row.status).toBe('pending_payment');
      expect(row.user.id).toBe(idOf('userB'));
    });

    it('shows a hotel booking with its hotel and its days as YYYY-MM-DD', async () => {
      const row = await rowOf(ids.hotelConfirmed);

      expect(row).toEqual({
        id: ids.hotelConfirmed.toString(),
        type: 'hotel',
        reference: references.hotelConfirmed,
        status: 'confirmed',
        user: {
          id: idOf('userB'),
          name: 'ACC-17 userB',
          email: accounts.get('userB')?.email,
        },
        providers: [{ type: 'hotel', id: hotelId.toString(), name: hotelName }],
        dates: { start: '2030-05-01', end: '2030-05-03' },
        amount: 30000,
        currency: 'USD',
        createdAt: '2001-03-12T15:00:00.000Z',
      });
    });
  });

  describe('privacy', () => {
    it('returns only the documented keys and no passenger, price, hold, policy or account data', async () => {
      const response = await inWindow();
      const text = JSON.stringify(response.body);

      for (const row of response.body.items as Row[]) {
        expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
        expect(Object.keys(row.user).sort()).toEqual(['email', 'id', 'name']);
        expect(Object.keys(row.dates).sort()).toEqual(['end', 'start']);
        for (const provider of row.providers) {
          expect(Object.keys(provider).sort()).toEqual(['id', 'name', 'type']);
        }
      }
      for (const forbidden of [
        'passengers',
        'passportNumber',
        'ACC17PASS1',
        'dateOfBirth',
        'fareTotal',
        'baggageTotal',
        'cancellationTiers',
        'holdExpiresAt',
        'policyAcceptedAt',
        'rooms',
        'userId',
        'passwordHash',
        'role',
        'stripe',
        'paymentIntent',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  describe('a refused request', () => {
    it('answers 400 for a parameter that is not allowed', async () => {
      const response = await list({ userId: idOf('userA') });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('userId');
    });

    it.each(['post', 'patch', 'delete'] as const)(
      'has no %s route',
      async (method) => {
        const response = await server()
          [method](ROUTE)
          .set('Cookie', cookies.get('admin') ?? '');

        expect(response.status).toBe(404);
      },
    );
  });

  describe('Swagger', () => {
    it('documents the route, its filters and its answers', async () => {
      const response = await server().get('/api/docs-json').expect(200);

      const route = response.body.paths[ROUTE].get;
      const parameters = (route.parameters as { name: string }[]).map(
        (parameter) => parameter.name,
      );
      expect(parameters).toEqual(
        expect.arrayContaining([
          'page',
          'limit',
          'type',
          'status',
          'from',
          'to',
        ]),
      );
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      expect(JSON.stringify(route.responses['200'])).toContain(
        'AdminBookingResponseDto',
      );
      expect(Object.keys(response.body.paths[ROUTE])).toEqual(['get']);
    });
  });

  describe('read only', () => {
    it('leaves the stored bookings unchanged', async () => {
      await inWindow();

      const flight = await flightBookings
        .findById(ids.flightPending)
        .lean()
        .exec();
      const hotel = await hotelBookings
        .findById(ids.hotelConfirmed)
        .lean()
        .exec();

      expect(flight).toMatchObject({
        status: 'pending_payment',
        total: 22500,
        updatedAt: new Date('2001-03-11T00:00:00.000Z'),
      });
      expect(flight?.passengers).toHaveLength(1);
      expect(hotel).toMatchObject({
        status: 'confirmed',
        reference: references.hotelConfirmed,
        updatedAt: new Date('2001-03-12T15:00:00.000Z'),
      });
    });
  });
});
