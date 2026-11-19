import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FlightBookingExpiryService } from './../src/flight-bookings/flight-booking-expiry.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  NOT_ENOUGH_SEATS_MESSAGE,
} from './../src/flights/flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
  type StoredCabin,
} from './support/flight-fixture';

const MINUTE_MS = 60_000;
const HOLD_MS = 10 * MINUTE_MS;

const RESPONSE_KEYS = [
  'createdAt',
  'currency',
  'fareTotal',
  'holdExpiresAt',
  'id',
  'passengerCounts',
  'segments',
  'status',
  'total',
];

interface BookingBody {
  id: string;
  status: string;
  holdExpiresAt: string;
  currency: string;
  fareTotal: number;
  total: number;
  segments: {
    flightId: string;
    cabin: string;
    fare: number;
    seatsReserved: number;
  }[];
  passengerCounts: { adults: number; children: number; infants: number };
  createdAt: string;
}

describe('Flight seat hold (e2e, FLT-22)', () => {
  let fx: FlightFixture;
  let bookings: Model<FlightBooking>;
  /** Every booking this suite created, deleted one by one in afterAll. */
  const bookingIds = new Set<string>();

  /** A valid body for POST /api/flight-bookings/hold. */
  const holdBody = (
    flightId: string,
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    flightId,
    cabin: CabinClass.Economy,
    passengers: { adults: 1, children: 0, infants: 0 },
    ...fields,
  });

  /** Sends a hold and records the booking it made, if any. */
  const hold = async (body: Record<string, unknown>, actor?: Actor) => {
    const call = fx.http().post('/api/flight-bookings/hold');
    const response = await (
      actor ? call.set('Cookie', actor.cookie) : call
    ).send(body);
    if (response.status === 201) {
      bookingIds.add((response.body as BookingBody).id);
    }
    return response;
  };

  /** A flight of the fixture's airline with one stored cabin. */
  const flightWith = (
    cabin: StoredCabin = {},
    options: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) => fx.insertFlight({ ...options, cabins: [fx.storedCabin(cabin)] });

  /** A cabin's seat counters as stored. */
  const countersOf = async (flightId: string, cabin = CabinClass.Economy) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    const stored = flight.cabins.find((item) => item.cabin === cabin);
    if (!stored) throw new Error(`No ${cabin} cabin on ${flightId}`);
    return { heldSeats: stored.heldSeats, bookedSeats: stored.bookedSeats };
  };

  /** Inserts a booking straight in the database and records it for cleanup. */
  const insertBooking = async (
    flightId: string,
    fields: Partial<FlightBooking>,
  ): Promise<string> => {
    const seats = fields.segments?.[0]?.seatsReserved ?? 2;
    const created = await bookings.create({
      userId: new Types.ObjectId(fx.user.id),
      status: FlightBookingStatus.PendingPayment,
      holdExpiresAt: new Date(Date.now() - MINUTE_MS),
      currency: 'USD',
      fareTotal: 10000 * seats,
      total: 10000 * seats,
      segments: [
        {
          flightId: new Types.ObjectId(flightId),
          airlineId: new Types.ObjectId(fx.airlineId),
          cabin: CabinClass.Economy,
          fare: 10000,
          seatsReserved: seats,
        },
      ],
      passengerCounts: { adults: seats, children: 0, infants: 0 },
      ...fields,
    });
    const id = created._id.toString();
    bookingIds.add(id);
    return id;
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt22');
    bookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    if (!fx) return;
    try {
      // The fixture's user is unique to this run, so its bookings are ours:
      // this also finds a booking whose 201 a failed test never recorded.
      const ours = await bookings
        .find({ userId: new Types.ObjectId(fx.user.id) })
        .select('_id')
        .lean()
        .exec();
      for (const { _id } of ours) bookingIds.add(_id.toString());
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  describe('holding seats', () => {
    it('holds 2 adults + 1 infant in economy for 10 minutes, priced from the cabin', async () => {
      const flightId = await flightWith({ price: 10005, heldSeats: 4 });
      const before = Date.now();

      const response = await hold(
        holdBody(flightId, {
          passengers: { adults: 2, children: 0, infants: 1 },
        }),
        fx.user,
      );
      const after = Date.now();

      expect(response.status).toBe(201);
      const body = response.body as BookingBody;
      expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS);
      expect(body.status).toBe('pending_payment');
      expect(body.holdExpiresAt).toMatch(/Z$/);
      const expiresAt = new Date(body.holdExpiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + HOLD_MS);
      expect(expiresAt).toBeLessThanOrEqual(after + HOLD_MS);
      expect(body.currency).toBe('USD');
      // 2 seats at 10005 cents, the infant at round(1000.5) = 1001 cents.
      expect(body.fareTotal).toBe(2 * 10005 + 1001);
      expect(body.total).toBe(body.fareTotal);
      expect(body.segments).toEqual([
        { flightId, cabin: 'economy', fare: 10005, seatsReserved: 2 },
      ]);
      expect(body.passengerCounts).toEqual({
        adults: 2,
        children: 0,
        infants: 1,
      });

      // Exactly the 2 seats were added to the cabin's held seats.
      expect(await countersOf(flightId)).toEqual({
        heldSeats: 6,
        bookedSeats: 0,
      });
      const stored = await bookings.findById(body.id).lean().orFail().exec();
      expect(stored.userId.toString()).toBe(fx.user.id);
      expect(stored.status).toBe(FlightBookingStatus.PendingPayment);
      expect(stored.reference).toBeUndefined();
    });

    it('never holds more seats than exist: 6 requests at once for 3 seats give three 201 and three 409', async () => {
      const flightId = await flightWith({ totalSeats: 3 });

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => hold(holdBody(flightId), fx.user)),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 201, 201, 409, 409, 409]);
      for (const response of responses.filter((r) => r.status === 409)) {
        expect(response.body.message).toBe(NOT_ENOUGH_SEATS_MESSAGE);
      }
      expect(await countersOf(flightId)).toEqual({
        heldSeats: 3,
        bookedSeats: 0,
      });
      expect(
        await bookings
          .countDocuments({ 'segments.flightId': new Types.ObjectId(flightId) })
          .exec(),
      ).toBe(3);
    });

    it('answers 409 when the cabin has too few seats left, and holds nothing', async () => {
      // 5 seats, 2 booked, 2 held: 1 left.
      const flightId = await flightWith({
        totalSeats: 5,
        bookedSeats: 2,
        heldSeats: 2,
      });

      const response = await hold(
        holdBody(flightId, {
          passengers: { adults: 1, children: 1, infants: 0 },
        }),
        fx.user,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(NOT_ENOUGH_SEATS_MESSAGE);
      expect(await countersOf(flightId)).toEqual({
        heldSeats: 2,
        bookedSeats: 2,
      });
    });
  });

  describe('flights that cannot be booked', () => {
    it.each([
      ['cancelled', { status: FlightStatus.Cancelled }],
      [
        'whose departure time has passed',
        { departureAt: new Date(Date.now() - 60 * MINUTE_MS) },
      ],
    ])(
      'answers 409 for a flight %s, and holds nothing',
      async (_label, options) => {
        const flightId = await flightWith({}, options);

        const response = await hold(holdBody(flightId), fx.user);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe(FLIGHT_NOT_BOOKABLE_MESSAGE);
        expect((await countersOf(flightId)).heldSeats).toBe(0);
      },
    );

    it('answers 404 for an unknown flight', async () => {
      const response = await hold(
        holdBody(new Types.ObjectId().toString()),
        fx.user,
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    });

    it('answers 404 for a cabin the flight does not have, and holds nothing', async () => {
      const flightId = await flightWith();

      const response = await hold(
        holdBody(flightId, { cabin: CabinClass.Business }),
        fx.user,
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('This flight has no business cabin');
      expect((await countersOf(flightId)).heldSeats).toBe(0);
    });

    it('answers 404 for a flight of a deactivated airline (ACC-15), and holds nothing', async () => {
      const flightId = await flightWith();
      await fx.airlines
        .findByIdAndUpdate(fx.airlineId, { $set: { active: false } })
        .exec();
      try {
        const response = await hold(holdBody(flightId), fx.user);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
        expect((await countersOf(flightId)).heldSeats).toBe(0);
      } finally {
        await fx.airlines
          .findByIdAndUpdate(fx.airlineId, { $set: { active: true } })
          .exec();
      }
    });
  });

  describe('validation and roles', () => {
    let flightId: string;

    beforeAll(async () => {
      flightId = await flightWith();
    });

    afterEach(async () => {
      // No refused request held a seat.
      expect((await countersOf(flightId)).heldSeats).toBe(0);
    });

    it.each([
      [
        'no adult',
        { passengers: { adults: 0, children: 1, infants: 0 } },
        'passengers.adults',
      ],
      [
        'more infants than adults',
        { passengers: { adults: 1, children: 0, infants: 2 } },
        'passengers.infants',
      ],
      [
        '10 seats',
        { passengers: { adults: 5, children: 5, infants: 0 } },
        'passengers.children',
      ],
      ['a price', { price: 1 }, 'price'],
      ['a status', { status: 'confirmed' }, 'status'],
      ['a bad flightId', { flightId: 'abc' }, 'flightId'],
      ['an unknown cabin', { cabin: 'deluxe' }, 'cabin'],
    ])('answers 400 for %s', async (_label, fields, field) => {
      const response = await hold(holdBody(flightId, fields), fx.user);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(
        (response.body.errors as { field: string }[]).map((e) => e.field),
      ).toEqual([field]);
    });

    it('answers 401 to a guest', async () => {
      const response = await hold(holdBody(flightId));

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['admin', 'moderator', 'hotelModerator'] as const)(
      'answers 403 to the %s account',
      async (role) => {
        const response = await hold(holdBody(flightId), fx[role]);

        expect(response.status).toBe(403);
      },
    );
  });

  describe('expiry of unpaid holds', () => {
    it('expires a due hold and releases its seats exactly once', async () => {
      // 5 held: 2 of them by the due booking below.
      const flightId = await flightWith({ totalSeats: 10, heldSeats: 5 });
      const bookingId = await insertBooking(flightId, {});
      const expiry = fx.app.get(FlightBookingExpiryService);

      // The every-minute job may run at the same moment: the result must be
      // the same whichever run expires the booking.
      await expiry.expireDueHolds(new Date());

      expect(
        (await bookings.findById(bookingId).lean().orFail().exec()).status,
      ).toBe(FlightBookingStatus.Expired);
      expect((await countersOf(flightId)).heldSeats).toBe(3);

      // A second run finds nothing to expire, so nothing is released twice.
      await expiry.expireDueHolds(new Date());

      expect((await countersOf(flightId)).heldSeats).toBe(3);
      expect(
        (await bookings.findById(bookingId).lean().orFail().exec()).status,
      ).toBe(FlightBookingStatus.Expired);
    });

    it('leaves a confirmed booking with a past hold untouched, and its seats held', async () => {
      const flightId = await flightWith({ totalSeats: 10, heldSeats: 3 });
      const bookingId = await insertBooking(flightId, {
        status: FlightBookingStatus.Confirmed,
      });

      await fx.app.get(FlightBookingExpiryService).expireDueHolds(new Date());

      expect(
        (await bookings.findById(bookingId).lean().orFail().exec()).status,
      ).toBe(FlightBookingStatus.Confirmed);
      expect((await countersOf(flightId)).heldSeats).toBe(3);
    });

    it('leaves a hold that has not ended untouched', async () => {
      const flightId = await flightWith({ totalSeats: 10, heldSeats: 2 });
      const bookingId = await insertBooking(flightId, {
        holdExpiresAt: new Date(Date.now() + HOLD_MS),
      });

      await fx.app.get(FlightBookingExpiryService).expireDueHolds(new Date());

      expect(
        (await bookings.findById(bookingId).lean().orFail().exec()).status,
      ).toBe(FlightBookingStatus.PendingPayment);
      expect((await countersOf(flightId)).heldSeats).toBe(2);
    });
  });

  it('documents POST /api/flight-bookings/hold in Swagger', async () => {
    const document = (await fx.http().get('/api/docs-json').expect(200)).body;
    const operation = document.paths['/api/flight-bookings/hold'].post as {
      summary: string;
      tags: string[];
      security: Record<string, unknown>[];
      requestBody: { content: Record<string, { schema: { $ref: string } }> };
      responses: Record<
        string,
        { content?: Record<string, { schema: { $ref: string } }> }
      >;
    };
    const schemas = document.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    expect(operation.summary).toBe('Hold seats for payment (FLT-22)');
    expect(operation.tags).toEqual(['Flight bookings']);
    expect(operation.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/HoldFlightBookingDto',
    );
    expect(
      operation.responses['201'].content?.['application/json'].schema.$ref,
    ).toBe('#/components/schemas/FlightBookingResponseDto');
    expect(Object.keys(schemas.HoldFlightBookingDto.properties).sort()).toEqual(
      ['cabin', 'flightId', 'passengers'],
    );
    expect(Object.keys(schemas.PassengerCountsDto.properties).sort()).toEqual([
      'adults',
      'children',
      'infants',
    ]);
    expect(
      Object.keys(schemas.FlightBookingResponseDto.properties).sort(),
    ).toEqual([...RESPONSE_KEYS, 'reference'].sort());
  });
});
