import './support/auth-env';
import { BadGatewayException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { Role } from './../src/common/enums/role.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import {
  BOOKING_PAYMENT_HANDLERS,
  type BookingPaymentHandlers,
} from './../src/payments/booking-payment-handler';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { PaymentStatus } from './../src/payments/enums/payment-status.enum';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { REFUND_NOT_FOUND_MESSAGE } from './../src/payments/refunds/refunds.constants';
import { RefundsService } from './../src/payments/refunds/refunds.service';
import {
  StripeGateway,
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

const MINUTE_MS = 60_000;

const REFUND_KEYS = [
  'amount',
  'bookingId',
  'bookingType',
  'createdAt',
  'currency',
  'id',
  'paymentId',
  'reason',
  'refundPercent',
  'status',
  'stripeRefundId',
  'updatedAt',
];

interface RefundBody {
  id: string;
  bookingType: string;
  bookingId: string;
  paymentId: string;
  amount: number;
  currency: string;
  refundPercent: number;
  reason: string;
  status: string;
  stripeRefundId: string | null;
}

describe('Refunds (e2e, PAY-03)', () => {
  let fx: FlightFixture;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let gateway: StripeGateway;
  let handlers: BookingPaymentHandlers;
  let refundsService: RefundsService;
  let stranger: Actor;
  /** The signer of webhook events: the real Stripe SDK, offline. */
  const signer = new Stripe('sk_test_e2e_signer_only');

  /** Everything this suite created, deleted one by one by id in afterAll. */
  const paymentIds = new Set<string>();
  const refundIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];

  let counter = 0;
  const next = () => `${fx.run}_${++counter}`;

  /**
   * A payment inserted straight in the `-test` database. There is no
   * cancellation route yet, and refunds read only payments, so no booking
   * document is needed: the booking id is a new id.
   */
  const insertPayment = async (
    fields: Partial<Payment> = {},
  ): Promise<{ id: string; bookingId: string; intentId: string }> => {
    const intentId = `pi_${next()}`;
    const created = await payments.create({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(),
      userId: new Types.ObjectId(fx.user.id),
      stripePaymentIntentId: intentId,
      amount: 25100,
      currency: 'USD',
      status: PaymentStatus.Succeeded,
      holdExpiresAt: new Date(Date.now() - MINUTE_MS),
      ...fields,
    });
    const id = created._id.toString();
    paymentIds.add(id);
    return { id, bookingId: created.bookingId.toString(), intentId };
  };

  /** Refunds a booking through the service and records the refund for cleanup. */
  const refundOf = async (
    bookingId: string,
    refundPercent = 100,
    reason = RefundReason.UserCancellation,
  ) => {
    const refund = await refundsService.refund({
      bookingType: BookingType.Flight,
      bookingId,
      refundPercent,
      reason,
    });
    if (refund) refundIds.add(refund.id);
    return refund;
  };

  const getRefund = (id: string, actor?: Actor) => {
    const call = fx.http().get(`/api/refunds/${id}`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  /** Sends a Stripe event signed with the test webhook secret. */
  const sendEvent = (
    type: string,
    object: Record<string, unknown>,
    eventId = `evt_${next()}`,
  ) => {
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type,
      data: { object },
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

  const storedRefundOf = (bookingId: string) =>
    refunds
      .findOne({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(bookingId),
      })
      .lean()
      .exec();

  const refundNotificationsOf = (userId: string) =>
    notifications
      .countDocuments({
        userId: new Types.ObjectId(userId),
        type: NotificationType.Refund,
      })
      .exec();

  beforeAll(async () => {
    fx = await createFlightFixture('pay03');
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    refunds = fx.app.get<Model<Refund>>(getModelToken(Refund.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));
    gateway = fx.app.get(StripeGateway);
    handlers = fx.app.get<BookingPaymentHandlers>(BOOKING_PAYMENT_HANDLERS);
    refundsService = fx.app.get(RefundsService);

    // Nothing in these tests reaches Stripe: only the signature check is real.
    jest.spyOn(gateway, 'createRefund').mockImplementation((refund) =>
      Promise.resolve<GatewayRefund>({
        id: `re_${next()}`,
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
      // The refund of a late payment is made by the webhook: find it too.
      for (const id of paymentIds) {
        const payment = await payments.findById(id).lean().exec();
        if (!payment) continue;
        const refund = await refunds
          .findOne({
            bookingType: payment.bookingType,
            bookingId: payment.bookingId,
          })
          .select('_id')
          .lean()
          .exec();
        if (refund) refundIds.add(refund._id.toString());
      }
      for (const id of refundIds) {
        await refunds.findByIdAndDelete(id).exec();
      }
      for (const id of paymentIds) {
        await payments.findByIdAndDelete(id).exec();
      }
      for (const id of eventIds) {
        await stripeEvents.findByIdAndDelete(id).exec();
      }
      // The refund notifications of the fixture's user and the stranger.
      for (const owner of [fx.user.id, ...userIds]) {
        const ours = await notifications
          .find({ userId: new Types.ObjectId(owner) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of ours) {
          await notifications.findByIdAndDelete(_id).exec();
        }
      }
      for (const id of userIds) {
        await deleteSessionsOf(fx.app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  describe('GET /api/refunds/:id', () => {
    let refundId: string;
    let bookingId: string;
    let paymentId: string;

    beforeAll(async () => {
      const payment = await insertPayment();
      bookingId = payment.bookingId;
      paymentId = payment.id;
      refundId = (await refundOf(bookingId, 50))?.id ?? '';
    });

    it('shows the owner their refund, with the exact fields and no owner id', async () => {
      const response = await getRefund(refundId, fx.user);

      expect(response.status).toBe(200);
      const body = response.body as RefundBody;
      expect(Object.keys(body).sort()).toEqual(REFUND_KEYS);
      expect(body).toMatchObject({
        id: refundId,
        bookingType: 'flight',
        bookingId,
        paymentId,
        amount: 12550,
        currency: 'USD',
        refundPercent: 50,
        reason: 'user_cancellation',
        status: 'pending',
      });
      expect(body.stripeRefundId).toMatch(/^re_/);
      expect(body).not.toHaveProperty('userId');
    });

    it('answers 401 to a guest', async () => {
      const response = await getRefund(refundId);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['admin', 'moderator'] as const)(
      'answers 403 to the %s account',
      async (role) => {
        expect((await getRefund(refundId, fx[role])).status).toBe(403);
      },
    );

    it('answers 400 for a bad id', async () => {
      expect((await getRefund('abc', fx.user)).status).toBe(400);
    });

    it("answers 404 for a missing refund and for someone else's, with the same message", async () => {
      const missing = await getRefund(new Types.ObjectId().toString(), fx.user);
      const foreign = await getRefund(refundId, stranger);

      expect([missing.status, foreign.status]).toEqual([404, 404]);
      expect(missing.body.message).toBe(REFUND_NOT_FOUND_MESSAGE);
      expect(foreign.body.message).toBe(REFUND_NOT_FOUND_MESSAGE);
    });
  });

  describe('RefundsService.refund', () => {
    it('records a pending 100% refund once and sends it to Stripe once, however often it is asked', async () => {
      const payment = await insertPayment();
      const calls = jest.mocked(gateway.createRefund).mock.calls.length;

      const first = await refundOf(payment.bookingId);
      const second = await refundOf(
        payment.bookingId,
        50,
        RefundReason.FlightCancelled,
      );

      expect(first).toMatchObject({
        amount: 25100,
        refundPercent: 100,
        status: 'pending',
      });
      expect(second).toEqual(first);
      const sent = jest.mocked(gateway.createRefund).mock.calls.slice(calls);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual([
        {
          paymentIntentId: payment.intentId,
          amount: 25100,
          metadata: { bookingType: 'flight', bookingId: payment.bookingId },
        },
        `refund-flight-${payment.bookingId}`,
      ]);
      expect(
        await refunds
          .countDocuments({
            bookingType: BookingType.Flight,
            bookingId: new Types.ObjectId(payment.bookingId),
          })
          .exec(),
      ).toBe(1);
    });

    it('creates nothing for 0%', async () => {
      const payment = await insertPayment();

      await expect(refundOf(payment.bookingId, 0)).resolves.toBeNull();
      expect(await storedRefundOf(payment.bookingId)).toBeNull();
    });

    it('leaves the refund pending without a Stripe id when Stripe fails, and does not throw', async () => {
      const payment = await insertPayment();
      jest
        .mocked(gateway.createRefund)
        .mockRejectedValueOnce(
          new BadGatewayException(
            'The payment service is unavailable. Try again',
          ),
        );

      const refund = await refundOf(payment.bookingId);

      expect(refund).toMatchObject({ status: 'pending', stripeRefundId: null });
      const stored = await storedRefundOf(payment.bookingId);
      expect(stored?.status).toBe(RefundStatus.Pending);
      expect(stored?.stripeRefundId).toBeUndefined();
    });

    it('sends the owner an in-app notification of type refund', async () => {
      const response = await fx
        .http()
        .get('/api/notifications')
        .set('Cookie', fx.user.cookie);

      expect(response.status).toBe(200);
      const items = (response.body as { items: { type: string }[] }).items;
      expect(items.some((item) => item.type === 'refund')).toBe(true);
    });
  });

  describe('the Stripe webhook', () => {
    it('moves a refund to refunded on a signed refund.updated, and a repeated event changes nothing', async () => {
      const payment = await insertPayment();
      const refund = await refundOf(payment.bookingId);
      const stripeRefund = {
        id: refund?.stripeRefundId,
        object: 'refund',
        status: 'succeeded',
        amount: 25100,
        currency: 'usd',
        payment_intent: payment.intentId,
      };
      const notifiedBefore = await refundNotificationsOf(fx.user.id);
      const eventId = `evt_${next()}`;

      const first = await sendEvent('refund.updated', stripeRefund, eventId);
      const repeated = await sendEvent('refund.updated', stripeRefund, eventId);
      // The same news in another event: the refund is already final.
      const again = await sendEvent('refund.updated', stripeRefund);

      expect([first.status, repeated.status, again.status]).toEqual([
        200, 200, 200,
      ]);
      expect((await storedRefundOf(payment.bookingId))?.status).toBe(
        RefundStatus.Refunded,
      );
      expect(await refundNotificationsOf(fx.user.id)).toBe(notifiedBefore + 1);
      expect(await stripeEvents.countDocuments({ _id: eventId })).toBe(1);
    });

    it('refunds a payment that arrives after its hold ended in full, once, as late_payment', async () => {
      const payment = await insertPayment({
        status: PaymentStatus.RequiresPayment,
      });
      const confirmPaid = jest.fn(() => Promise.resolve(false));
      const before = handlers[BookingType.Flight];
      handlers[BookingType.Flight] = { confirmPaid };
      try {
        const intent = {
          id: payment.intentId,
          object: 'payment_intent',
          amount: 25100,
          amount_received: 25100,
          currency: 'usd',
        };

        const first = await sendEvent('payment_intent.succeeded', intent);
        const second = await sendEvent('payment_intent.succeeded', intent);

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(confirmPaid).toHaveBeenCalled();
      } finally {
        handlers[BookingType.Flight] = before;
      }

      const stored = await storedRefundOf(payment.bookingId);
      expect(stored).toMatchObject({
        amount: 25100,
        refundPercent: 100,
        reason: RefundReason.LatePayment,
        currency: 'USD',
      });
      if (stored) refundIds.add(stored._id.toString());
      expect(
        await refunds
          .countDocuments({
            bookingType: BookingType.Flight,
            bookingId: new Types.ObjectId(payment.bookingId),
          })
          .exec(),
      ).toBe(1);
      expect(
        (await payments.findById(payment.id).lean().orFail().exec()).status,
      ).toBe(PaymentStatus.Succeeded);
    });
  });

  it('documents GET /api/refunds/{id} in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');

    expect(response.status).toBe(200);
    const paths = (
      response.body as { paths: Record<string, Record<string, unknown>> }
    ).paths;
    expect(paths['/api/refunds/{id}']).toHaveProperty('get');
    expect(paths['/api/refunds/{id}']).not.toHaveProperty('post');
    expect(paths['/api/refunds']).toBeUndefined();
  });
});
