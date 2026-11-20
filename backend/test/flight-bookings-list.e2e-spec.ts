import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { Role } from './../src/common/enums/role.enum';
import { CancelledBy } from './../src/flight-bookings/enums/cancelled-by.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/flight-bookings/flight-bookings.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import {
  StripeGateway,
  type GatewayIntent,
} from './../src/payments/stripe.gateway';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { sessionCookieFor } from './support/session-cookie';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRICE = 25000;

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

interface ListItem {
  id: string;
  reference: string | null;
  status: string;
  segments: {
    cabin: string;
    seatsReserved: number;
    flight: { id: string; departureLocal: string; status: string } | null;
  }[];
  passengers: { fullName: string; type: string }[];
}

interface ListBody {
  items: ListItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * FLT-25 end to end, on the "-test" database: this suite's own user has a
 * booking in every state, made through the real hold, payment and signed
 * webhook (FLT-23) and cancellation (FLT-26), and reads them through the
 * lists and the details. Only the Stripe calls are replaced. Every record is
 * deleted by id.
 */
describe('My flight bookings (e2e, FLT-25)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let stranger: Actor;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];
  let counter = 0;

  /** The bookings every test reads, made once in beforeAll. */
  const made = {} as Record<
    'soon' | 'later' | 'pending' | 'flown' | 'cancelled' | 'expired',
    { id: string; flightId: string }
  >;

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const heldBooking = async (
    departureAt: Date,
  ): Promise<{ id: string; flightId: string }> => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ price: PRICE })],
      departureAt,
    });
    const hold = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send({
        flightId,
        cabin: CabinClass.Economy,
        passengers: [
          {
            fullName: 'List Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'LIST12345',
          },
        ],
      });
    expect(hold.status).toBe(201);
    const id = (hold.body as { id: string }).id;
    bookingIds.add(id);
    const accepted = await fx
      .http()
      .post(`/api/bookings/flight/${id}/accept-policies`)
      .set('Cookie', fx.user.cookie)
      .send({ accepted: true });
    expect(accepted.status).toBe(200);
    return { id, flightId };
  };

  const confirmedBooking = async (departureAt: Date) => {
    const booking = await heldBooking(departureAt);
    const started = await fx
      .http()
      .post('/api/payments')
      .set('Cookie', fx.user.cookie)
      .send({ bookingType: 'flight', bookingId: booking.id });
    expect(started.status).toBe(201);
    const payment = started.body as PaymentBody;
    paymentIds.add(payment.id);
    const eventId = `evt_${fx.run}_${++counter}`;
    eventIds.add(eventId);
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.stripePaymentIntentId,
          object: 'payment_intent',
          amount: payment.amount,
          amount_received: payment.amount,
          currency: 'usd',
        },
      },
    });
    const webhook = await fx
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signer.webhooks.generateTestHeaderString({
          payload,
          secret: TEST_STRIPE_WEBHOOK_SECRET,
        }),
      )
      .send(payload);
    expect(webhook.status).toBe(200);
    return booking;
  };

  const list = (query: string, actor: Actor | null = fx.user) => {
    const call = fx.http().get(`/api/flight-bookings${query}`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const details = (id: string, actor: Actor | null = fx.user) => {
    const call = fx.http().get(`/api/flight-bookings/${id}`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const idsOf = (body: unknown) => (body as ListBody).items.map((i) => i.id);

  beforeAll(async () => {
    fx = await createFlightFixture('flt25');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));

    // Nothing reaches Stripe: only the signature check is real.
    const gateway = fx.app.get(StripeGateway);
    jest
      .spyOn(gateway, 'createPaymentIntent')
      .mockImplementation((intent) =>
        Promise.resolve(fakeIntent(`pi_${fx.run}_${++counter}`, intent.amount)),
      );
    jest
      .spyOn(gateway, 'retrievePaymentIntent')
      .mockImplementation((id) => Promise.resolve(fakeIntent(id)));
    jest
      .spyOn(gateway, 'cancelPaymentIntent')
      .mockImplementation((id) =>
        Promise.resolve({ ...fakeIntent(id), status: 'canceled' }),
      );

    const created = await users.create({
      name: `${fx.run} stranger`,
      email: `${fx.run}-stranger-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      consentAcceptedAt: new Date(),
    });
    userIds.push(created._id.toString());
    stranger = {
      id: created._id.toString(),
      cookie: await sessionCookieFor(fx.app, created._id.toString()),
    };

    const now = Date.now();
    made.later = await confirmedBooking(new Date(now + 20 * DAY_MS));
    made.soon = await confirmedBooking(new Date(now + 10 * DAY_MS));
    made.pending = await heldBooking(new Date(now + 15 * DAY_MS));
    made.flown = await confirmedBooking(new Date(now + 30 * DAY_MS));
    made.cancelled = await confirmedBooking(new Date(now + 40 * DAY_MS));
    made.expired = await heldBooking(new Date(now + 50 * DAY_MS));

    // This suite's own flight left yesterday; this suite's own hold ended.
    await fx.flights
      .updateOne(
        { _id: made.flown.flightId },
        {
          $set: {
            departureAt: new Date(now - DAY_MS),
            arrivalAt: new Date(now - DAY_MS + 2 * HOUR_MS),
          },
        },
      )
      .exec();
    await flightBookings
      .updateOne(
        { _id: made.expired.id },
        { $set: { holdExpiresAt: new Date(now - 60_000) } },
      )
      .exec();
    // The airline has no tiers, so the user's cancellation refunds 0%.
    const cancelled = await fx
      .http()
      .post(`/api/flight-bookings/${made.cancelled.id}/cancel`)
      .set('Cookie', fx.user.cookie)
      .send({ expectedRefundPercent: 0 });
    expect(cancelled.status).toBe(200);
    // Several real bookings on the "-test" database: more than the default 30 s.
  }, 180_000);

  afterAll(async () => {
    if (!fx) return;
    jest.restoreAllMocks();
    try {
      for (const id of bookingIds) {
        const ours = await notifications
          .find({ linkId: id })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of ours) {
          await notifications.findByIdAndDelete(_id).exec();
        }
      }
      for (const id of paymentIds) {
        await payments.findByIdAndDelete(id).exec();
      }
      for (const id of eventIds) {
        await stripeEvents.findByIdAndDelete(id).exec();
      }
      for (const id of bookingIds) {
        await flightBookings.findByIdAndDelete(id).exec();
      }
      for (const id of userIds) {
        await deleteSessionsOf(fx.app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  it('lists the upcoming bookings by default, soonest departure first, with the hold that still lasts', async () => {
    const response = await list('');

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([
      made.soon.id,
      made.pending.id,
      made.later.id,
    ]);
    const [soon, pending] = (response.body as ListBody).items;
    expect(soon).toMatchObject({
      status: FlightBookingStatus.Confirmed,
      passengers: [{ fullName: 'List Test Adult', type: 'adult' }],
      segments: [
        {
          cabin: CabinClass.Economy,
          seatsReserved: 1,
          flight: { id: made.soon.flightId, status: 'scheduled' },
        },
      ],
    });
    expect(soon.reference).toMatch(/\S/);
    expect(pending).toMatchObject({
      status: FlightBookingStatus.PendingPayment,
      reference: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('LIST12345');
  });

  it('lists a confirmed booking whose flight has departed as past', async () => {
    const response = await list('?group=past');

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([made.flown.id]);
  });

  it('lists the cancelled bookings', async () => {
    const response = await list('?group=cancelled');

    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([made.cancelled.id]);
    expect((response.body as ListBody).items[0].status).toBe(
      FlightBookingStatus.Cancelled,
    );
  });

  it('never lists an expired hold', async () => {
    for (const group of ['upcoming', 'past', 'cancelled']) {
      const response = await list(`?group=${group}`);
      expect(idsOf(response.body)).not.toContain(made.expired.id);
    }
  });

  it('pages a list and counts the whole group', async () => {
    const first = await list('?group=upcoming&limit=2');
    const second = await list('?group=upcoming&limit=2&page=2');

    expect((first.body as ListBody).meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(idsOf(first.body)).toEqual([made.soon.id, made.pending.id]);
    expect(idsOf(second.body)).toEqual([made.later.id]);
  });

  it('shows another user none of these bookings', async () => {
    for (const group of ['upcoming', 'past', 'cancelled']) {
      const response = await list(`?group=${group}`, stranger);
      expect(response.status).toBe(200);
      expect((response.body as ListBody).items).toEqual([]);
    }
  });

  it('opens the full details of a confirmed booking', async () => {
    const response = await details(made.soon.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: made.soon.id,
      status: FlightBookingStatus.Confirmed,
      total: PRICE,
      passengers: [{ passportNumber: 'LIST12345' }],
      flights: [{ id: made.soon.flightId }],
      cancelledAt: null,
      cancelledBy: null,
      refund: null,
    });
    expect(
      (response.body as { policyAcceptedAt: string }).policyAcceptedAt,
    ).toMatch(/Z$/);
  });

  it('shows who cancelled a booking, when, and the refund percent', async () => {
    const response = await details(made.cancelled.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: FlightBookingStatus.Cancelled,
      cancelledBy: CancelledBy.User,
      refundPercent: 0,
      refund: null,
    });
    expect((response.body as { cancelledAt: string }).cancelledAt).toMatch(
      /Z$/,
    );
  });

  it('answers 404 for another user’s booking or one that does not exist', async () => {
    for (const response of [
      await details(made.soon.id, stranger),
      await details(new Types.ObjectId().toString()),
    ]) {
      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe(
        BOOKING_NOT_FOUND_MESSAGE,
      );
    }
  });

  it('needs a login (401) and a registered user (403)', async () => {
    expect((await list('', null)).status).toBe(401);
    expect((await details(made.soon.id, null)).status).toBe(401);
    for (const actor of [fx.admin, fx.moderator]) {
      expect((await list('', actor)).status).toBe(403);
      expect((await details(made.soon.id, actor)).status).toBe(403);
    }
  });

  it('answers 400 for a bad group, page or id', async () => {
    const badGroup = await list('?group=expired');
    expect(badGroup.status).toBe(400);
    expect(JSON.stringify(badGroup.body)).toContain(
      'group must be one of: upcoming, past, cancelled',
    );
    expect((await list('?page=0')).status).toBe(400);
    expect((await list('?status=confirmed')).status).toBe(400);
    expect((await details('not-an-id')).status).toBe(400);
  });

  it('is documented in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');
    const paths = (
      response.body as {
        paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
      }
    ).paths;

    expect(
      Object.keys(paths['/api/flight-bookings']?.get?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['200', '400', '401', '403']));
    expect(
      Object.keys(paths['/api/flight-bookings/{id}']?.get?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404']));
  });
});
