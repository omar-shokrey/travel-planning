import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { Role } from './../src/common/enums/role.enum';
import { CancelledBy } from './../src/flight-bookings/enums/cancelled-by.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import {
  DEPARTED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './../src/flight-bookings/flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/flight-bookings/flight-bookings.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import {
  StripeGateway,
  type GatewayIntent,
  type GatewayRefund,
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
const PRICE = 25000;
/** The fixture airline's tiers, copied into each booking at hold time (PAY-02). */
const TIERS = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 3, refundPercent: 50 },
];

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

interface PreviewBody {
  bookingId: string;
  departureAt: string;
  daysRemaining: number;
  refundPercent: number;
  total: number;
  refundAmount: number;
  currency: string;
}

interface CancelBody extends PreviewBody {
  status: string;
  cancelledAt: string;
  refund: {
    id: string;
    status: string;
    amount: number;
    currency: string;
    refundPercent: number;
  } | null;
}

/**
 * FLT-26 end to end, on the "-test" database: a booking confirmed through
 * the real hold, policies, payment and signed webhook (FLT-23), then
 * viewed and cancelled through the routes. Only the Stripe calls are
 * replaced. Every record is deleted by id.
 */
describe('Flight booking cancellation (e2e, FLT-26)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let gateway: StripeGateway;
  let stranger: Actor;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];
  let counter = 0;

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  /** A booking held through the real route, with its policies accepted. */
  const heldBooking = async (
    departureAt?: Date,
  ): Promise<{ id: string; flightId: string }> => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ price: PRICE })],
      ...(departureAt && { departureAt }),
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
            fullName: 'Cancel Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'CANC12345',
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

  /** A booking confirmed by a verified payment (FLT-23). */
  const confirmedBooking = async (departureAt?: Date) => {
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
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
    return booking;
  };

  const preview = (id: string, actor?: Actor) => {
    const call = fx.http().get(`/api/flight-bookings/${id}/cancel`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const cancel = (id: string, body: unknown, actor?: Actor) => {
    const call = fx.http().post(`/api/flight-bookings/${id}/cancel`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as object,
    );
  };

  const storedBooking = (id: string) =>
    flightBookings.findById(id).lean().orFail().exec();

  const cabinOf = async (flightId: string) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    return flight.cabins[0];
  };

  const refundsOf = (bookingId: string) =>
    refunds
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .lean()
      .exec();

  beforeAll(async () => {
    fx = await createFlightFixture('flt26');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    refunds = fx.app.get<Model<Refund>>(getModelToken(Refund.name));
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));

    // This suite's own airline: the tiers every booking below copies.
    await fx.airlines
      .updateOne(
        { _id: fx.airlineId },
        { $set: { 'policy.cancellationTiers': TIERS } },
      )
      .exec();

    // Nothing reaches Stripe: only the signature check is real.
    gateway = fx.app.get(StripeGateway);
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
    jest.spyOn(gateway, 'createRefund').mockImplementation((refund) =>
      Promise.resolve<GatewayRefund>({
        id: `re_${fx.run}_${++counter}`,
        status: 'pending',
        amount: refund.amount,
        currency: 'usd',
        paymentIntentId: refund.paymentIntentId,
      }),
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
  });

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
        for (const { _id } of await refundsOf(id)) {
          await refunds.findByIdAndDelete(_id).exec();
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

  it('shows the refund of the tier for the days left, and changes nothing', async () => {
    const booking = await confirmedBooking();

    const response = await preview(booking.id, fx.user);

    expect(response.status).toBe(200);
    const body = response.body as PreviewBody;
    expect(body).toMatchObject({
      bookingId: booking.id,
      refundPercent: 100,
      total: PRICE,
      refundAmount: PRICE,
      currency: 'USD',
    });
    // The fixture flight departs in 30 days, less the seconds this test took.
    expect(body.daysRemaining).toBeGreaterThanOrEqual(29);
    expect(body.departureAt).toMatch(/Z$/);
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
    expect((await cabinOf(booking.flightId)).bookedSeats).toBe(1);
    expect(await refundsOf(booking.id)).toHaveLength(0);
  });

  it('cancels with the confirmed refund: cancelled, seats back, one refund and its notification', async () => {
    const booking = await confirmedBooking();

    const response = await cancel(
      booking.id,
      { expectedRefundPercent: 100 },
      fx.user,
    );

    expect(response.status).toBe(200);
    const body = response.body as CancelBody;
    expect(body).toMatchObject({
      bookingId: booking.id,
      status: FlightBookingStatus.Cancelled,
      refundPercent: 100,
      refundAmount: PRICE,
      refund: {
        status: RefundStatus.Pending,
        amount: PRICE,
        currency: 'USD',
        refundPercent: 100,
      },
    });
    expect(body.cancelledAt).toMatch(/Z$/);

    const stored = await storedBooking(booking.id);
    expect(stored).toMatchObject({
      status: FlightBookingStatus.Cancelled,
      cancelledBy: CancelledBy.User,
      refundPercent: 100,
    });
    expect(stored.cancelledAt?.toISOString()).toBe(body.cancelledAt);
    expect(await cabinOf(booking.flightId)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 0,
    });
    const saved = await refundsOf(booking.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      reason: RefundReason.UserCancellation,
      amount: PRICE,
      refundPercent: 100,
    });
    const sent = await notifications
      .find({ userId: fx.user.id, linkId: booking.id })
      .lean()
      .exec();
    expect(sent.map((n) => n.type)).toContain(NotificationType.Refund);
  });

  it('applies a lower tier closer to departure: 50% of the total', async () => {
    const booking = await confirmedBooking(new Date(Date.now() + 5 * DAY_MS));

    const shown = await preview(booking.id, fx.user);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({
      daysRemaining: 4,
      refundPercent: 50,
      refundAmount: PRICE / 2,
    });

    const response = await cancel(
      booking.id,
      { expectedRefundPercent: 50 },
      fx.user,
    );
    expect(response.status).toBe(200);
    expect((response.body as CancelBody).refund).toMatchObject({
      amount: PRICE / 2,
      refundPercent: 50,
    });
  });

  it('answers 409 when the refund is not the one confirmed, and changes nothing', async () => {
    const booking = await confirmedBooking(new Date(Date.now() + 5 * DAY_MS));

    const response = await cancel(
      booking.id,
      { expectedRefundPercent: 100 },
      fx.user,
    );

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      REFUND_CHANGED_MESSAGE,
    );
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
    expect((await cabinOf(booking.flightId)).bookedSeats).toBe(1);
    expect(await refundsOf(booking.id)).toHaveLength(0);
  });

  it('cancels once when two cancellations arrive at the same moment', async () => {
    const booking = await confirmedBooking();

    const answers = await Promise.all([
      cancel(booking.id, { expectedRefundPercent: 100 }, fx.user),
      cancel(booking.id, { expectedRefundPercent: 100 }, fx.user),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect((await cabinOf(booking.flightId)).bookedSeats).toBe(0);
    expect(await refundsOf(booking.id)).toHaveLength(1);
  });

  it('answers 409 for a booking that is already cancelled, on both routes', async () => {
    const booking = await confirmedBooking();
    expect(
      (await cancel(booking.id, { expectedRefundPercent: 100 }, fx.user))
        .status,
    ).toBe(200);

    const again = await cancel(
      booking.id,
      { expectedRefundPercent: 100 },
      fx.user,
    );
    const shown = await preview(booking.id, fx.user);

    for (const response of [again, shown]) {
      expect(response.status).toBe(409);
      expect((response.body as { message: string }).message).toBe(
        NOT_CANCELLABLE_MESSAGE,
      );
    }
    expect(await refundsOf(booking.id)).toHaveLength(1);
  });

  it('answers 409 for a booking still waiting for payment', async () => {
    const booking = await heldBooking();

    const response = await cancel(
      booking.id,
      { expectedRefundPercent: 100 },
      fx.user,
    );

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      NOT_CANCELLABLE_MESSAGE,
    );
    expect((await cabinOf(booking.flightId)).heldSeats).toBe(1);
  });

  it('answers 409 once the flight has departed', async () => {
    const booking = await confirmedBooking();
    // This suite's own flight: it departed an hour ago.
    await fx.flights
      .updateOne(
        { _id: booking.flightId },
        {
          $set: {
            departureAt: new Date(Date.now() - 60 * 60 * 1000),
            arrivalAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      )
      .exec();

    for (const response of [
      await preview(booking.id, fx.user),
      await cancel(booking.id, { expectedRefundPercent: 0 }, fx.user),
    ]) {
      expect(response.status).toBe(409);
      expect((response.body as { message: string }).message).toBe(
        DEPARTED_MESSAGE,
      );
    }
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
  });

  it('answers 404 for another user’s booking or one that does not exist', async () => {
    const booking = await confirmedBooking();
    const missing = new Types.ObjectId().toString();

    for (const response of [
      await preview(booking.id, stranger),
      await cancel(booking.id, { expectedRefundPercent: 100 }, stranger),
      await preview(missing, fx.user),
      await cancel(missing, { expectedRefundPercent: 100 }, fx.user),
    ]) {
      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe(
        BOOKING_NOT_FOUND_MESSAGE,
      );
    }
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
  });

  it('needs a login (401) and a registered user (403)', async () => {
    const booking = await confirmedBooking();

    expect((await preview(booking.id)).status).toBe(401);
    expect(
      (await cancel(booking.id, { expectedRefundPercent: 100 })).status,
    ).toBe(401);
    for (const actor of [fx.admin, fx.moderator]) {
      expect((await preview(booking.id, actor)).status).toBe(403);
      expect(
        (await cancel(booking.id, { expectedRefundPercent: 100 }, actor))
          .status,
      ).toBe(403);
    }
  });

  it('answers 400 for a bad id or body, naming the field', async () => {
    const booking = await confirmedBooking();

    expect((await preview('not-an-id', fx.user)).status).toBe(400);
    for (const [body, message] of [
      [{}, 'expectedRefundPercent is required'],
      [
        { expectedRefundPercent: 12.5 },
        'expectedRefundPercent must be a whole number',
      ],
      [
        { expectedRefundPercent: 101 },
        'expectedRefundPercent must be at most 100',
      ],
      [
        { expectedRefundPercent: 100, refundAmount: 1 },
        'property refundAmount should not exist',
      ],
    ] as const) {
      const response = await cancel(booking.id, body, fx.user);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(message);
    }
    expect((await storedBooking(booking.id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
  });

  it('is documented in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');
    const route = (
      response.body as {
        paths: Record<
          string,
          {
            get?: { responses: Record<string, unknown> };
            post?: { responses: Record<string, unknown> };
          }
        >;
      }
    ).paths['/api/flight-bookings/{id}/cancel'];

    expect(Object.keys(route?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
    expect(Object.keys(route?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });
});
