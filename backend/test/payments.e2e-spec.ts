import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { Role } from './../src/common/enums/role.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import {
  BOOKING_PAYMENT_HANDLERS,
  type BookingPaymentHandlers,
} from './../src/payments/booking-payment-handler';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { PaymentStatus } from './../src/payments/enums/payment-status.enum';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { PaymentExpiryService } from './../src/payments/payment-expiry.service';
import {
  ALREADY_PAID_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from './../src/payments/payments.constants';
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

const MINUTE_MS = 60_000;

interface PaymentBody {
  id: string;
  bookingType: string;
  bookingId: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  holdExpiresAt: string;
  clientSecret?: string;
}

describe('Payments (e2e, PAY-01)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let users: Model<User>;
  let gateway: StripeGateway;
  let handlers: BookingPaymentHandlers;
  let stranger: Actor;
  /** The signer of webhook events: the real Stripe SDK, offline. */
  const signer = new Stripe('sk_test_e2e_signer_only');

  /** Everything this suite created, deleted one by one by id in afterAll. */
  const flightBookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];

  let intentCounter = 0;
  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  /**
   * A flight booking made through the real hold route, with its policies
   * accepted unless `accept` is false. Returns the booking id and its total.
   */
  const bookingToPay = async (
    accept = true,
  ): Promise<{ id: string; total: number }> => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ price: 25000 })],
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
            fullName: 'Payment Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'PAYTEST01',
          },
        ],
      });
    expect(hold.status).toBe(201);
    const { id, total } = hold.body as { id: string; total: number };
    flightBookingIds.add(id);
    if (accept) {
      const accepted = await fx
        .http()
        .post(`/api/bookings/flight/${id}/accept-policies`)
        .set('Cookie', fx.user.cookie)
        .send({ accepted: true });
      expect(accepted.status).toBe(200);
    }
    return { id, total };
  };

  const pay = (body: unknown, actor?: Actor) => {
    const call = fx.http().post('/api/payments');
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  /** Starts the payment of a fresh booking and remembers it for cleanup. */
  const startedPayment = async (): Promise<PaymentBody> => {
    const booking = await bookingToPay();
    const response = await pay(
      { bookingType: 'flight', bookingId: booking.id },
      fx.user,
    );
    expect(response.status).toBe(201);
    const body = response.body as PaymentBody;
    paymentIds.add(body.id);
    return body;
  };

  /** Sends a Stripe event signed with the test webhook secret. */
  const sendEvent = (
    type: string,
    intent: {
      id: string;
      amount: number;
      amountReceived?: number;
      currency?: string;
    },
    eventId = `evt_${fx.run}_${++intentCounter}`,
  ) => {
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type,
      data: {
        object: {
          id: intent.id,
          object: 'payment_intent',
          amount: intent.amount,
          amount_received: intent.amountReceived ?? 0,
          currency: intent.currency ?? 'usd',
        },
      },
    });
    eventIds.add(eventId);
    const signature = signer.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_STRIPE_WEBHOOK_SECRET,
    });
    return fx
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  };

  const storedPayment = (id: string) =>
    payments.findById(id).lean().orFail().exec();

  beforeAll(async () => {
    fx = await createFlightFixture('pay01');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));
    gateway = fx.app.get(StripeGateway);
    handlers = fx.app.get<BookingPaymentHandlers>(BOOKING_PAYMENT_HANDLERS);

    // Nothing in these tests reaches Stripe: only the signature check is real.
    jest
      .spyOn(gateway, 'createPaymentIntent')
      .mockImplementation((intent) =>
        Promise.resolve(
          fakeIntent(`pi_${fx.run}_${++intentCounter}`, intent.amount),
        ),
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
    const strangerId = created._id.toString();
    userIds.push(strangerId);
    stranger = {
      id: strangerId,
      cookie: await sessionCookieFor(fx.app, strangerId),
    };
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    if (!fx) return;
    jest.restoreAllMocks();
    try {
      for (const id of paymentIds) {
        await payments.findByIdAndDelete(id).exec();
      }
      for (const id of eventIds) {
        await stripeEvents.findByIdAndDelete(id).exec();
      }
      for (const id of flightBookingIds) {
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

  describe('POST /api/payments: starting a payment', () => {
    it('creates a PaymentIntent for the booking total, in USD, and stores only the allowed fields', async () => {
      const booking = await bookingToPay();

      const response = await pay(
        { bookingType: 'flight', bookingId: booking.id },
        fx.user,
      );

      expect(response.status).toBe(201);
      const body = response.body as PaymentBody;
      paymentIds.add(body.id);
      expect(body).toMatchObject({
        bookingType: 'flight',
        bookingId: booking.id,
        amount: booking.total,
        currency: 'USD',
        status: 'requires_payment',
      });
      expect(body.stripePaymentIntentId).toMatch(/^pi_/);
      expect(body.clientSecret).toBe(
        `${body.stripePaymentIntentId}_secret_e2e`,
      );
      expect(body.holdExpiresAt).toMatch(/Z$/);
      expect(body).not.toHaveProperty('userId');
      expect(gateway.createPaymentIntent).toHaveBeenLastCalledWith(
        {
          amount: booking.total,
          currency: 'USD',
          bookingType: 'flight',
          bookingId: booking.id,
        },
        `payment-flight-${booking.id}`,
      );

      const stored = await storedPayment(body.id);
      expect(Object.keys(stored).sort()).toEqual(
        [
          '__v',
          '_id',
          'amount',
          'bookingId',
          'bookingType',
          'createdAt',
          'currency',
          'holdExpiresAt',
          'status',
          'stripePaymentIntentId',
          'updatedAt',
          'userId',
        ].sort(),
      );
    });

    it('does not confirm the booking: only the webhook does', async () => {
      const payment = await startedPayment();

      const booking = await flightBookings
        .findById(payment.bookingId)
        .lean()
        .orFail()
        .exec();
      expect(booking.status).toBe('pending_payment');
      expect(booking.reference).toBeUndefined();
    });

    it('returns the same PaymentIntent when asked again, and creates nothing new', async () => {
      const first = await startedPayment();
      const calls = jest.mocked(gateway.createPaymentIntent).mock.calls.length;

      const second = await pay(
        { bookingType: 'flight', bookingId: first.bookingId },
        fx.user,
      );

      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({
        id: first.id,
        stripePaymentIntentId: first.stripePaymentIntentId,
        clientSecret: first.clientSecret,
      });
      expect(jest.mocked(gateway.createPaymentIntent).mock.calls).toHaveLength(
        calls,
      );
      expect(
        await payments.countDocuments({ bookingId: first.bookingId }),
      ).toBe(1);
    });

    it('answers 409 and does not call Stripe while the policies are not accepted', async () => {
      const booking = await bookingToPay(false);
      const calls = jest.mocked(gateway.createPaymentIntent).mock.calls.length;

      const response = await pay(
        { bookingType: 'flight', bookingId: booking.id },
        fx.user,
      );

      expect(response.status).toBe(409);
      expect((response.body as { message: string }).message).toBe(
        POLICIES_NOT_ACCEPTED_MESSAGE,
      );
      expect(jest.mocked(gateway.createPaymentIntent).mock.calls).toHaveLength(
        calls,
      );
      expect(await payments.countDocuments({ bookingId: booking.id })).toBe(0);
    });

    it('answers 409 when the hold has ended', async () => {
      const booking = await bookingToPay();
      await flightBookings
        .findByIdAndUpdate(booking.id, {
          $set: { holdExpiresAt: new Date(Date.now() - MINUTE_MS) },
        })
        .exec();

      const response = await pay(
        { bookingType: 'flight', bookingId: booking.id },
        fx.user,
      );

      expect(response.status).toBe(409);
      expect(await payments.countDocuments({ bookingId: booking.id })).toBe(0);
    });

    it("answers 404 for someone else's booking, like a booking that does not exist", async () => {
      const booking = await bookingToPay();

      const theirs = await pay(
        { bookingType: 'flight', bookingId: booking.id },
        stranger,
      );
      const missing = await pay(
        { bookingType: 'flight', bookingId: new Types.ObjectId().toString() },
        fx.user,
      );

      expect(theirs.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(theirs.body).toMatchObject({ message: 'Booking not found' });
      expect(await payments.countDocuments({ bookingId: booking.id })).toBe(0);
    });

    it('refuses a body with an amount, a currency or an owner: the client never sets them', async () => {
      const booking = await bookingToPay();

      const response = await pay(
        {
          bookingType: 'flight',
          bookingId: booking.id,
          amount: 1,
          currency: 'EUR',
          userId: stranger.id,
        },
        fx.user,
      );

      expect(response.status).toBe(400);
      const fields = (
        response.body as { errors: { field: string }[] }
      ).errors.map((error) => error.field);
      expect(fields.sort()).toEqual(['amount', 'currency', 'userId']);
    });

    it('answers 400 for a bad type or id', async () => {
      const response = await pay(
        { bookingType: 'car', bookingId: 'abc' },
        fx.user,
      );

      expect(response.status).toBe(400);
    });

    it('answers 401 to a guest and 403 to every role but a registered user', async () => {
      const body = {
        bookingType: 'flight',
        bookingId: '6740f1c2a4b5c6d7e8f90789',
      };

      expect((await pay(body)).status).toBe(401);
      expect((await pay(body, fx.admin)).status).toBe(403);
      expect((await pay(body, fx.moderator)).status).toBe(403);
      expect((await pay(body, fx.hotelModerator)).status).toBe(403);
    });
  });

  describe('GET /api/payments/:id', () => {
    it('shows the status to the owner, never the client secret', async () => {
      const payment = await startedPayment();

      const response = await fx
        .http()
        .get(`/api/payments/${payment.id}`)
        .set('Cookie', fx.user.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: payment.id,
        status: 'requires_payment',
        amount: payment.amount,
        currency: 'USD',
      });
      expect(response.body).not.toHaveProperty('clientSecret');
      expect(response.body).not.toHaveProperty('userId');
    });

    it('answers 404 to another user, 401 to a guest and 400 to a bad id', async () => {
      const payment = await startedPayment();

      const theirs = await fx
        .http()
        .get(`/api/payments/${payment.id}`)
        .set('Cookie', stranger.cookie);
      expect(theirs.status).toBe(404);
      expect((theirs.body as { message: string }).message).toBe(
        PAYMENT_NOT_FOUND_MESSAGE,
      );
      expect((await fx.http().get(`/api/payments/${payment.id}`)).status).toBe(
        401,
      );
      expect(
        (
          await fx
            .http()
            .get('/api/payments/not-an-id')
            .set('Cookie', fx.user.cookie)
        ).status,
      ).toBe(400);
    });
  });

  describe('POST /api/payments/webhook', () => {
    it('answers 400 and changes nothing without a signature, with a wrong one, or for a changed body', async () => {
      const payment = await startedPayment();
      const payload = JSON.stringify({
        id: `evt_${fx.run}_forged`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: payment.stripePaymentIntentId,
            amount: payment.amount,
            amount_received: payment.amount,
            currency: 'usd',
          },
        },
      });
      const post = (signature?: string) => {
        const call = fx
          .http()
          .post('/api/payments/webhook')
          .set('Content-Type', 'application/json');
        return (
          signature ? call.set('Stripe-Signature', signature) : call
        ).send(payload);
      };

      expect((await post()).status).toBe(400);
      expect((await post('t=1,v1=deadbeef')).status).toBe(400);
      const signed = signer.webhooks.generateTestHeaderString({
        payload,
        secret: TEST_STRIPE_WEBHOOK_SECRET,
      });
      const changed = await fx
        .http()
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signed)
        .send(payload.replace('"usd"', '"eur"'));
      expect(changed.status).toBe(400);

      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.RequiresPayment,
      );
      expect(
        await stripeEvents.countDocuments({ _id: `evt_${fx.run}_forged` }),
      ).toBe(0);
    });

    it('marks the payment failed, then a retry reopens the same PaymentIntent until the hold ends', async () => {
      const payment = await startedPayment();

      const failed = await sendEvent('payment_intent.payment_failed', {
        id: payment.stripePaymentIntentId,
        amount: payment.amount,
      });
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual({ received: true });
      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.Failed,
      );

      // Starting a new payment for the same booking is refused: use the retry.
      const again = await pay(
        { bookingType: 'flight', bookingId: payment.bookingId },
        fx.user,
      );
      expect(again.status).toBe(409);
      expect((again.body as { message: string }).message).toBe(
        PAYMENT_FAILED_MESSAGE,
      );

      const retried = await fx
        .http()
        .post(`/api/payments/${payment.id}/retry`)
        .set('Cookie', fx.user.cookie);
      expect(retried.status).toBe(200);
      expect(retried.body).toMatchObject({
        id: payment.id,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        status: 'requires_payment',
        clientSecret: payment.clientSecret,
      });
      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.RequiresPayment,
      );
    });

    it('answers 404 to a retry by another user, 401 to a guest', async () => {
      const payment = await startedPayment();

      expect(
        (
          await fx
            .http()
            .post(`/api/payments/${payment.id}/retry`)
            .set('Cookie', stranger.cookie)
        ).status,
      ).toBe(404);
      expect(
        (await fx.http().post(`/api/payments/${payment.id}/retry`)).status,
      ).toBe(401);
    });

    it('refuses to retry once the hold has ended', async () => {
      const payment = await startedPayment();
      await sendEvent('payment_intent.payment_failed', {
        id: payment.stripePaymentIntentId,
        amount: payment.amount,
      });
      await flightBookings
        .findByIdAndUpdate(payment.bookingId, {
          $set: { holdExpiresAt: new Date(Date.now() - MINUTE_MS) },
        })
        .exec();

      const retried = await fx
        .http()
        .post(`/api/payments/${payment.id}/retry`)
        .set('Cookie', fx.user.cookie);

      expect(retried.status).toBe(409);
      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.Failed,
      );
    });

    it('verifies a successful payment, asks the booking module to confirm, and ignores the same event sent again', async () => {
      const payment = await startedPayment();
      const confirmPaid = jest.fn(() => Promise.resolve(true));
      const before = handlers[BookingType.Flight];
      handlers[BookingType.Flight] = { confirmPaid };
      try {
        const eventId = `evt_${fx.run}_paid_${payment.id}`;
        const intent = {
          id: payment.stripePaymentIntentId,
          amount: payment.amount,
          amountReceived: payment.amount,
        };

        const first = await sendEvent(
          'payment_intent.succeeded',
          intent,
          eventId,
        );
        const repeated = await sendEvent(
          'payment_intent.succeeded',
          intent,
          eventId,
        );

        expect(first.status).toBe(200);
        expect(repeated.status).toBe(200);
        expect((await storedPayment(payment.id)).status).toBe(
          PaymentStatus.Succeeded,
        );
        expect(confirmPaid).toHaveBeenCalledTimes(1);
        expect(confirmPaid).toHaveBeenCalledWith(
          payment.bookingId,
          expect.any(Date),
        );
        expect(await stripeEvents.countDocuments({ _id: eventId })).toBe(1);
      } finally {
        handlers[BookingType.Flight] = before;
      }

      // A paid booking cannot be paid again.
      const paidAgain = await pay(
        { bookingType: 'flight', bookingId: payment.bookingId },
        fx.user,
      );
      expect(paidAgain.status).toBe(409);
      expect((paidAgain.body as { message: string }).message).toBe(
        ALREADY_PAID_MESSAGE,
      );
    });

    it('does not mark a payment succeeded when Stripe received another amount', async () => {
      const payment = await startedPayment();

      const response = await sendEvent('payment_intent.succeeded', {
        id: payment.stripePaymentIntentId,
        amount: payment.amount,
        amountReceived: 1,
      });

      expect(response.status).toBe(200);
      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.RequiresPayment,
      );
    });

    it('accepts events it does not need: an unknown PaymentIntent and another event type', async () => {
      const unknown = await sendEvent('payment_intent.succeeded', {
        id: `pi_${fx.run}_unknown`,
        amount: 100,
        amountReceived: 100,
      });
      const other = await sendEvent('payment_intent.created', {
        id: `pi_${fx.run}_other`,
        amount: 100,
      });

      expect(unknown.status).toBe(200);
      expect(other.status).toBe(200);
    });

    it('moves a payment to cancelled when Stripe cancels the PaymentIntent', async () => {
      const payment = await startedPayment();

      await sendEvent('payment_intent.canceled', {
        id: payment.stripePaymentIntentId,
        amount: payment.amount,
      });

      expect((await storedPayment(payment.id)).status).toBe(
        PaymentStatus.Cancelled,
      );
    });
  });

  describe('when the hold ends', () => {
    it('cancels the PaymentIntent of an open payment whose hold ended, and leaves the others', async () => {
      const ended = await payments.create({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(),
        userId: new Types.ObjectId(fx.user.id),
        stripePaymentIntentId: `pi_${fx.run}_ended`,
        amount: 25000,
        currency: 'USD',
        status: PaymentStatus.RequiresPayment,
        holdExpiresAt: new Date(Date.now() - MINUTE_MS),
      });
      const live = await payments.create({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(),
        userId: new Types.ObjectId(fx.user.id),
        stripePaymentIntentId: `pi_${fx.run}_live`,
        amount: 25000,
        currency: 'USD',
        status: PaymentStatus.RequiresPayment,
        holdExpiresAt: new Date(Date.now() + 5 * MINUTE_MS),
      });
      const paid = await payments.create({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(),
        userId: new Types.ObjectId(fx.user.id),
        stripePaymentIntentId: `pi_${fx.run}_paid`,
        amount: 25000,
        currency: 'USD',
        status: PaymentStatus.Succeeded,
        holdExpiresAt: new Date(Date.now() - MINUTE_MS),
      });
      for (const created of [ended, live, paid]) {
        paymentIds.add(created._id.toString());
      }

      // The app's own cron job may have cancelled it a moment before this call.
      await fx.app.get(PaymentExpiryService).cancelDuePayments(new Date());

      expect((await storedPayment(ended._id.toString())).status).toBe(
        PaymentStatus.Cancelled,
      );
      expect(gateway.cancelPaymentIntent).toHaveBeenCalledWith(
        `pi_${fx.run}_ended`,
      );
      expect((await storedPayment(live._id.toString())).status).toBe(
        PaymentStatus.RequiresPayment,
      );
      expect((await storedPayment(paid._id.toString())).status).toBe(
        PaymentStatus.Succeeded,
      );
      expect(gateway.cancelPaymentIntent).not.toHaveBeenCalledWith(
        `pi_${fx.run}_live`,
      );
      expect(gateway.cancelPaymentIntent).not.toHaveBeenCalledWith(
        `pi_${fx.run}_paid`,
      );
    });
  });

  it('documents the four payment routes in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');

    expect(response.status).toBe(200);
    const paths = (
      response.body as { paths: Record<string, Record<string, unknown>> }
    ).paths;
    expect(paths['/api/payments']).toHaveProperty('post');
    expect(paths['/api/payments/{id}']).toHaveProperty('get');
    expect(paths['/api/payments/{id}/retry']).toHaveProperty('post');
    expect(paths['/api/payments/webhook']).toHaveProperty('post');
  });
});
