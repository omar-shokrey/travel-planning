import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { Role } from './../src/common/enums/role.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import {
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
} from './../src/payments/payments.constants';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { sessionCookieFor } from './support/session-cookie';

const MINUTE_MS = 60_000;

const AIRLINE_POLICY = {
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
  extraBagPrice: 4500,
  maxExtraBags: 2,
};

const HOTEL_TIERS = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 2, refundPercent: 25 },
];

interface PoliciesBody {
  type: string;
  bookingId: string;
  status: string;
  holdExpiresAt: string | null;
  policyAcceptedAt: string | null;
  flight?: { segments: Record<string, unknown>[] };
  hotel?: Record<string, unknown>;
}

describe('Booking policies (e2e, PAY-02)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;
  let users: Model<User>;
  /** A second registered user, who must never see the first one's bookings. */
  let stranger: Actor;
  /** Everything this suite created, deleted one by one by id in afterAll. */
  const flightBookingIds = new Set<string>();
  const hotelBookingIds = new Set<string>();
  const userIds: string[] = [];

  const policiesOf = (type: string, id: string, actor?: Actor) => {
    const call = fx.http().get(`/api/bookings/${type}/${id}/policies`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const accept = (type: string, id: string, body: unknown, actor?: Actor) => {
    const call = fx.http().post(`/api/bookings/${type}/${id}/accept-policies`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  /** A flight booking made through the real hold route, with the airline's policy copied. */
  const holdFlight = async (): Promise<string> => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ freeBags: 2, maxBagKg: 32 })],
    });
    const response = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send({
        flightId,
        cabin: CabinClass.Economy,
        passengers: [
          {
            fullName: 'Policy Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'POLICY001',
          },
        ],
      });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    flightBookingIds.add(id);
    return id;
  };

  /** A hotel reservation inserted straight in the database: these routes only read it. */
  const insertHotelBooking = async (
    fields: Partial<HotelBooking> = {},
  ): Promise<string> => {
    const created = await hotelBookings.create({
      userId: new Types.ObjectId(fx.user.id),
      hotelId: new Types.ObjectId(),
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      nights: 3,
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      currency: 'USD',
      total: 37500,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: 12500,
          adults: 2,
          childAges: [],
        },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: HOTEL_TIERS,
      ...fields,
    });
    const id = created._id.toString();
    hotelBookingIds.add(id);
    return id;
  };

  const storedHotel = (id: string) =>
    hotelBookings.findById(id).lean().orFail().exec();

  beforeAll(async () => {
    fx = await createFlightFixture('pay02');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    hotelBookings = fx.app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));
    const created = await users.create({
      name: `${fx.run} stranger`,
      email: `${fx.run}-stranger-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      consentAcceptedAt: new Date(),
    });
    const strangerId = created._id.toString();
    userIds.push(strangerId);
    stranger = {
      id: strangerId,
      cookie: await sessionCookieFor(fx.app, strangerId),
    };
    await fx.airlines
      .findByIdAndUpdate(fx.airlineId, { $set: { policy: AIRLINE_POLICY } })
      .exec();
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    if (!fx) return;
    try {
      for (const id of flightBookingIds) {
        await flightBookings.findByIdAndDelete(id).exec();
      }
      for (const id of hotelBookingIds) {
        await hotelBookings.findByIdAndDelete(id).exec();
      }
      for (const id of userIds) {
        await deleteSessionsOf(fx.app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  describe('showing the policies', () => {
    it("shows a flight booking's copied cancellation and baggage policy", async () => {
      const id = await holdFlight();

      const response = await policiesOf('flight', id, fx.user);

      expect(response.status).toBe(200);
      const body = response.body as PoliciesBody;
      expect(body).toMatchObject({
        type: 'flight',
        bookingId: id,
        status: 'pending_payment',
        policyAcceptedAt: null,
      });
      expect(body.holdExpiresAt).toMatch(/Z$/);
      expect(body).not.toHaveProperty('hotel');
      expect(body.flight?.segments).toEqual([
        {
          flightId: expect.any(String),
          cabin: 'economy',
          cancellationTiers: AIRLINE_POLICY.cancellationTiers,
          baggage: {
            freeBags: 2,
            maxBagKg: 32,
            extraBagPrice: 4500,
            maxExtraBags: 2,
            currency: 'USD',
          },
        },
      ]);
    });

    it("shows a hotel reservation's times and tiers", async () => {
      const id = await insertHotelBooking();

      const response = await policiesOf('hotel', id, fx.user);

      expect(response.status).toBe(200);
      const body = response.body as PoliciesBody;
      expect(body).toMatchObject({
        type: 'hotel',
        bookingId: id,
        policyAcceptedAt: null,
        hotel: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: HOTEL_TIERS,
        },
      });
      expect(body).not.toHaveProperty('flight');
      expect(body).not.toHaveProperty('userId');
    });
  });

  describe('accepting the policies', () => {
    it('stores the acceptance once and keeps the first timestamp', async () => {
      const id = await holdFlight();
      const before = Date.now();

      const first = await accept('flight', id, { accepted: true }, fx.user);

      expect(first.status).toBe(200);
      const acceptedAt = (first.body as PoliciesBody).policyAcceptedAt;
      expect(acceptedAt).toMatch(/Z$/);
      expect(new Date(acceptedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        before,
      );
      const stored = await flightBookings.findById(id).lean().orFail().exec();
      expect(stored.policyAcceptedAt?.toISOString()).toBe(acceptedAt);

      const second = await accept('flight', id, { accepted: true }, fx.user);

      expect(second.status).toBe(200);
      expect((second.body as PoliciesBody).policyAcceptedAt).toBe(acceptedAt);
      const shown = await policiesOf('flight', id, fx.user);
      expect((shown.body as PoliciesBody).policyAcceptedAt).toBe(acceptedAt);
    });

    it('accepts a hotel reservation too', async () => {
      const id = await insertHotelBooking();

      const response = await accept('hotel', id, { accepted: true }, fx.user);

      expect(response.status).toBe(200);
      expect((await storedHotel(id)).policyAcceptedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['accepted: false', { accepted: false }],
      ['no accepted', {}],
      ['an extra field', { accepted: true, policyAcceptedAt: '2027-01-01' }],
    ])('answers 400 for %s and stores nothing', async (_label, body) => {
      const id = await insertHotelBooking();

      const response = await accept('hotel', id, body, fx.user);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect((await storedHotel(id)).policyAcceptedAt).toBeUndefined();
    });

    it('answers 409 when the hold has expired, and stores nothing', async () => {
      const id = await insertHotelBooking({
        holdExpiresAt: new Date(Date.now() - MINUTE_MS),
      });

      const response = await accept('hotel', id, { accepted: true }, fx.user);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(HOLD_EXPIRED_MESSAGE);
      expect((await storedHotel(id)).policyAcceptedAt).toBeUndefined();
    });

    it('answers 409 for a confirmed booking, and stores nothing', async () => {
      const id = await insertHotelBooking({
        status: HotelBookingStatus.Confirmed,
      });

      const response = await accept('hotel', id, { accepted: true }, fx.user);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(NOT_WAITING_FOR_PAYMENT_MESSAGE);
      expect((await storedHotel(id)).policyAcceptedAt).toBeUndefined();
    });
  });

  describe('who may see and accept', () => {
    let flightId: string;
    let hotelId: string;

    beforeAll(async () => {
      flightId = await holdFlight();
      hotelId = await insertHotelBooking();
    });

    afterEach(async () => {
      // No refused request accepted anything.
      expect((await storedHotel(hotelId)).policyAcceptedAt).toBeUndefined();
      expect(
        (await flightBookings.findById(flightId).lean().orFail().exec())
          .policyAcceptedAt,
      ).toBeUndefined();
    });

    it('answers 404 to another user, on both routes, for both types', async () => {
      for (const [type, id] of [
        ['flight', flightId],
        ['hotel', hotelId],
      ]) {
        const shown = await policiesOf(type, id, stranger);
        const accepted = await accept(type, id, { accepted: true }, stranger);

        expect([shown.status, accepted.status]).toEqual([404, 404]);
        expect(shown.body.message).toBe('Booking not found');
      }
    });

    it('answers 401 to a guest', async () => {
      const shown = await policiesOf('hotel', hotelId);
      const accepted = await accept('hotel', hotelId, { accepted: true });

      expect([shown.status, accepted.status]).toEqual([401, 401]);
      expect(shown.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['admin', 'moderator'] as const)(
      'answers 403 to the %s account',
      async (role) => {
        const shown = await policiesOf('hotel', hotelId, fx[role]);
        const accepted = await accept(
          'hotel',
          hotelId,
          { accepted: true },
          fx[role],
        );

        expect([shown.status, accepted.status]).toEqual([403, 403]);
      },
    );

    it('answers 400 for a bad type or id, and 404 for an unknown id', async () => {
      const badType = await policiesOf('car', hotelId, fx.user);
      const badId = await accept('hotel', 'abc', { accepted: true }, fx.user);
      const unknown = await policiesOf(
        'hotel',
        new Types.ObjectId().toString(),
        fx.user,
      );
      // A flight id asked for as a hotel is not that hotel's booking.
      const wrongType = await policiesOf('hotel', flightId, fx.user);

      expect(badType.status).toBe(400);
      expect(badType.body.errors).toEqual([
        { field: 'type', messages: ['type must be one of: flight, hotel'] },
      ]);
      expect(badId.status).toBe(400);
      expect(badId.body.errors).toEqual([
        { field: 'id', messages: ['id must be a valid id'] },
      ]);
      expect(unknown.status).toBe(404);
      expect(wrongType.status).toBe(404);
    });
  });

  it('documents both routes in Swagger', async () => {
    const document = (await fx.http().get('/api/docs-json').expect(200)).body;
    type Operation = {
      summary: string;
      tags: string[];
      security: Record<string, unknown>[];
      parameters: { name: string; in: string }[];
      requestBody?: { content: Record<string, { schema: { $ref: string } }> };
      responses: Record<
        string,
        { content?: Record<string, { schema: { $ref: string } }> }
      >;
    };
    const show = document.paths['/api/bookings/{type}/{id}/policies']
      .get as Operation;
    const acceptOp = document.paths['/api/bookings/{type}/{id}/accept-policies']
      .post as Operation;
    const ref = '#/components/schemas/BookingPoliciesResponseDto';

    expect(show.summary).toBe(
      "Show the provider's policies before payment (PAY-02)",
    );
    expect(acceptOp.summary).toBe("Accept the provider's policies (PAY-02)");
    for (const operation of [show, acceptOp]) {
      expect(operation.tags).toEqual(['Payments']);
      expect(operation.security).toEqual([{ cookie: [] }]);
      expect(
        operation.parameters
          .filter((parameter) => parameter.in === 'path')
          .map((parameter) => parameter.name)
          .sort(),
      ).toEqual(['id', 'type']);
      expect(
        operation.responses['200'].content?.['application/json'].schema.$ref,
      ).toBe(ref);
    }
    expect(Object.keys(show.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(Object.keys(acceptOp.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(acceptOp.requestBody?.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/AcceptPoliciesDto',
    );
  });
});
