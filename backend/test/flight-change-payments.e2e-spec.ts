import './support/auth-env';
import {
  ConflictException,
  Global,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { Types, type Model } from 'mongoose';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Role } from './../src/common/enums/role.enum';
import { FlightBookingsService } from './../src/flight-bookings/flight-bookings.service';
import { NotificationLinkType } from './../src/notifications/enums/notification-link-type.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { PaymentStatus } from './../src/payments/enums/payment-status.enum';
import {
  FLIGHT_CHANGE_PAYMENT_PORT,
  type FlightChangeLink,
  type FlightChangePayable,
  type FlightChangePaymentPort,
} from './../src/payments/flight-change-payment-port';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { PaymentExpiryService } from './../src/payments/payment-expiry.service';
import {
  BOOKING_NOT_FOUND_MESSAGE,
  HOLD_EXPIRED_MESSAGE,
} from './../src/payments/payments.constants';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { REFUND_EXCEEDS_PAYMENT_MESSAGE } from './../src/payments/refunds/refunds.constants';
import { RefundsService } from './../src/payments/refunds/refunds.service';
import {
  StripeGateway,
  type GatewayIntent,
  type GatewayRefund,
} from './../src/payments/stripe.gateway';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const MINUTE_MS = 60_000;

/** One flight change as the fake port knows it. */
interface FakeChange {
  userId: string;
  bookingId: string;
  amount: number;
  holdExpiresAt: Date;
  policiesAccepted: boolean;
}

/**
 * A stand-in for the port the flight-bookings module will provide (FLT-27,
 * PR B). It follows the contract: 404 for a missing change or someone else's,
 * 409 when the hold ended, the amount and currency from the change only.
 */
class FakeFlightChangePort implements FlightChangePaymentPort {
  readonly changes = new Map<string, FakeChange>();
  /** What confirmPaid answers: true applies the change, false is a late payment. */
  confirmAnswer = true;
  readonly findPayable = jest.fn(
    (changeId: string, userId: string, now: Date) => {
      const change = this.changes.get(changeId);
      if (!change || change.userId !== userId) {
        return Promise.reject(new NotFoundException(BOOKING_NOT_FOUND_MESSAGE));
      }
      if (change.holdExpiresAt.getTime() <= now.getTime()) {
        return Promise.reject(new ConflictException(HOLD_EXPIRED_MESSAGE));
      }
      return Promise.resolve<FlightChangePayable>({
        amount: change.amount,
        currency: 'USD',
        holdExpiresAt: change.holdExpiresAt,
      });
    },
  );
  readonly confirmPaid = jest.fn((_changeId: string, _now: Date) =>
    Promise.resolve(this.confirmAnswer),
  );
  readonly linkOf = jest.fn((changeId: string) => {
    const change = this.changes.get(changeId);
    return Promise.resolve<FlightChangeLink | null>(
      change
        ? { bookingType: BookingType.Flight, bookingId: change.bookingId }
        : null,
    );
  });
}

const port = new FakeFlightChangePort();

/** Provides the fake port to the whole app, as FlightBookingsModule will. */
@Global()
@Module({
  providers: [{ provide: FLIGHT_CHANGE_PAYMENT_PORT, useValue: port }],
  exports: [FLIGHT_CHANGE_PAYMENT_PORT],
})
class FakeFlightChangePortModule {}

interface Actor {
  id: string;
  cookie: string;
}

interface PaymentBody {
  id: string;
  bookingType: string;
  bookingId: string;
  amount: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string;
}

describe('Payments and refunds of a flight change (e2e, FLT-27 with PAY-01, PAY-03)', () => {
  let app: NestExpressApplication;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let gateway: StripeGateway;
  let refundsService: RefundsService;
  let owner: Actor;
  let stranger: Actor;
  let admin: Actor;
  const run = `flt27pay-${randomUUID().slice(0, 8)}`;
  const signer = new Stripe('sk_test_e2e_signer_only');
  const http = () => request(app.getHttpServer());

  /** Everything this suite created, deleted one by one by id in afterAll. */
  const paymentIds = new Set<string>();
  const refundIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];

  let counter = 0;
  const next = () => `${run}_${++counter}`;
  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  /** A change the fake port knows, waiting for payment, owned by `owner`. */
  const newChange = (fields: Partial<FakeChange> = {}): string => {
    const id = new Types.ObjectId().toString();
    port.changes.set(id, {
      userId: owner.id,
      bookingId: new Types.ObjectId().toString(),
      amount: 4200,
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      policiesAccepted: true,
      ...fields,
    });
    return id;
  };

  const pay = (body: Record<string, unknown>, actor?: Actor) => {
    const call = http().post('/api/payments');
    return (actor ? call.set('Cookie', actor.cookie) : call).send(body);
  };

  const startedChangePayment = async (changeId = newChange()) => {
    const response = await pay(
      { bookingType: 'flight_change', bookingId: changeId },
      owner,
    );
    expect(response.status).toBe(201);
    const body = response.body as PaymentBody;
    paymentIds.add(body.id);
    return { changeId, body };
  };

  const sendEvent = (type: string, intentId: string, amount: number) => {
    const eventId = `evt_${next()}`;
    eventIds.add(eventId);
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type,
      data: {
        object: {
          id: intentId,
          object: 'payment_intent',
          amount,
          amount_received: type === 'payment_intent.succeeded' ? amount : 0,
          currency: 'usd',
        },
      },
    });
    return http()
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
  };

  const storedPayment = (id: string) =>
    payments.findById(id).lean().orFail().exec();

  /** A succeeded flight payment inserted straight in the `-test` database. */
  const insertFlightPayment = async (amount = 25100) => {
    const created = await payments.create({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(),
      userId: new Types.ObjectId(owner.id),
      stripePaymentIntentId: `pi_${next()}`,
      amount,
      currency: 'USD',
      status: PaymentStatus.Succeeded,
      holdExpiresAt: new Date(Date.now() - MINUTE_MS),
    });
    paymentIds.add(created._id.toString());
    return created.bookingId.toString();
  };

  const createActor = async (role: Role): Promise<Actor> => {
    const created = await users.create({
      name: `${run} ${role}`,
      email: `${run}-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
    });
    const id = created._id.toString();
    userIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, FakeFlightChangePortModule],
    }).compile();
    // rawBody: true like main.ts, so the webhook can check its signature.
    app = moduleFixture.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app);
    setupSwagger(app);
    await app.init();

    payments = app.get<Model<Payment>>(getModelToken(Payment.name));
    refunds = app.get<Model<Refund>>(getModelToken(Refund.name));
    stripeEvents = app.get<Model<StripeEvent>>(getModelToken(StripeEvent.name));
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = app.get<Model<User>>(getModelToken(User.name));
    gateway = app.get(StripeGateway);
    refundsService = app.get(RefundsService);

    // Nothing in these tests reaches Stripe: only the signature check is real.
    jest
      .spyOn(gateway, 'createPaymentIntent')
      .mockImplementation((intent) =>
        Promise.resolve(fakeIntent(`pi_${next()}`, intent.amount)),
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
        id: `re_${next()}`,
        status: 'pending',
        amount: refund.amount,
        currency: 'usd',
        paymentIntentId: refund.paymentIntentId,
      }),
    );

    owner = await createActor(Role.User);
    stranger = await createActor(Role.User);
    admin = await createActor(Role.Admin);
  });

  afterAll(async () => {
    if (!app) return;
    jest.restoreAllMocks();
    try {
      // The refunds of this suite's payments, including those the webhook made.
      for (const id of paymentIds) {
        const found = await refunds
          .find({ paymentId: new Types.ObjectId(id) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of found) refundIds.add(_id.toString());
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
      for (const id of userIds) {
        const ours = await notifications
          .find({ userId: new Types.ObjectId(id) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of ours) {
          await notifications.findByIdAndDelete(_id).exec();
        }
        await deleteSessionsOf(app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await app.close();
    }
  });

  describe('POST /api/payments with bookingType flight_change', () => {
    it('charges the amount and currency the port gives, keyed on the change', async () => {
      const changeId = newChange({ amount: 4200 });

      const { body } = await startedChangePayment(changeId);

      expect(body).toMatchObject({
        bookingType: 'flight_change',
        bookingId: changeId,
        amount: 4200,
        currency: 'USD',
        status: 'requires_payment',
      });
      expect(port.findPayable).toHaveBeenLastCalledWith(
        changeId,
        owner.id,
        expect.any(Date),
      );
      expect(gateway.createPaymentIntent).toHaveBeenLastCalledWith(
        {
          amount: 4200,
          currency: 'USD',
          bookingType: 'flight_change',
          bookingId: changeId,
        },
        `payment-flight_change-${changeId}`,
      );
    });

    it('refuses an amount sent by the client (400) and calls neither the port nor Stripe', async () => {
      const changeId = newChange();
      const portCalls = port.findPayable.mock.calls.length;
      const stripeCalls = jest.mocked(gateway.createPaymentIntent).mock.calls
        .length;

      const response = await pay(
        { bookingType: 'flight_change', bookingId: changeId, amount: 1 },
        owner,
      );

      expect(response.status).toBe(400);
      expect(port.findPayable.mock.calls.length).toBe(portCalls);
      expect(jest.mocked(gateway.createPaymentIntent).mock.calls.length).toBe(
        stripeCalls,
      );
    });

    it("answers the port's 404 for someone else's change and 409 for an ended hold, and creates no payment", async () => {
      const mine = newChange();
      const ended = newChange({ holdExpiresAt: new Date(Date.now() - 1000) });

      const other = await pay(
        { bookingType: 'flight_change', bookingId: mine },
        stranger,
      );
      const late = await pay(
        { bookingType: 'flight_change', bookingId: ended },
        owner,
      );

      expect(other.status).toBe(404);
      expect(other.body).toMatchObject({ message: BOOKING_NOT_FOUND_MESSAGE });
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({ message: HOLD_EXPIRED_MESSAGE });
      expect(
        await payments.countDocuments({
          bookingType: BookingType.FlightChange,
          bookingId: { $in: [mine, ended].map((id) => new Types.ObjectId(id)) },
        }),
      ).toBe(0);
    });

    it('returns the same PaymentIntent when asked twice (one payment per change)', async () => {
      const { changeId, body } = await startedChangePayment();

      const again = await pay(
        { bookingType: 'flight_change', bookingId: changeId },
        owner,
      );

      expect(again.status).toBe(201);
      expect((again.body as PaymentBody).id).toBe(body.id);
    });

    it('answers 401 for a guest', async () => {
      const response = await pay({
        bookingType: 'flight_change',
        bookingId: newChange(),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('reading and retrying a change payment', () => {
    it('shows it to its owner only: 200 for the owner, 404 for another user, 401 for a guest', async () => {
      const { body } = await startedChangePayment();

      const mine = await http()
        .get(`/api/payments/${body.id}`)
        .set('Cookie', owner.cookie);
      const theirs = await http()
        .get(`/api/payments/${body.id}`)
        .set('Cookie', stranger.cookie);
      const guest = await http().get(`/api/payments/${body.id}`);

      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({
        id: body.id,
        bookingType: 'flight_change',
      });
      expect(mine.body).not.toHaveProperty('clientSecret');
      expect(theirs.status).toBe(404);
      expect(guest.status).toBe(401);
    });

    it('retries a failed change payment while the port says it is payable', async () => {
      const { changeId, body } = await startedChangePayment();
      const failed = await sendEvent(
        'payment_intent.payment_failed',
        body.stripePaymentIntentId,
        body.amount,
      );
      expect(failed.status).toBe(200);
      expect((await storedPayment(body.id)).status).toBe(PaymentStatus.Failed);

      const retried = await http()
        .post(`/api/payments/${body.id}/retry`)
        .set('Cookie', owner.cookie);

      expect(retried.status).toBe(200);
      expect((await storedPayment(body.id)).status).toBe(
        PaymentStatus.RequiresPayment,
      );
      expect(port.findPayable).toHaveBeenLastCalledWith(
        changeId,
        owner.id,
        expect.any(Date),
      );
    });
  });

  describe('the webhook', () => {
    it('marks the payment succeeded and asks the port, never the flight booking service, to apply the change', async () => {
      port.confirmAnswer = true;
      const flightConfirm = jest.spyOn(
        app.get(FlightBookingsService),
        'confirmPaid',
      );
      const { changeId, body } = await startedChangePayment();

      const response = await sendEvent(
        'payment_intent.succeeded',
        body.stripePaymentIntentId,
        body.amount,
      );

      expect(response.status).toBe(200);
      expect((await storedPayment(body.id)).status).toBe(
        PaymentStatus.Succeeded,
      );
      expect(port.confirmPaid).toHaveBeenLastCalledWith(
        changeId,
        expect.any(Date),
      );
      expect(flightConfirm).not.toHaveBeenCalled();
      expect(
        await refunds.countDocuments({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(changeId),
        }),
      ).toBe(0);
      flightConfirm.mockRestore();
    });

    it('refunds a late change payment in full, keyed on the change, and links the notification to the flight booking', async () => {
      port.confirmAnswer = false;
      const changeId = newChange({ amount: 4200 });
      const { bookingId } = port.changes.get(changeId) as FakeChange;
      const { body } = await startedChangePayment(changeId);

      try {
        const response = await sendEvent(
          'payment_intent.succeeded',
          body.stripePaymentIntentId,
          body.amount,
        );
        expect(response.status).toBe(200);
      } finally {
        port.confirmAnswer = true;
      }

      const refund = await refunds
        .findOne({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(changeId),
        })
        .lean()
        .orFail()
        .exec();
      refundIds.add(refund._id.toString());
      expect(refund).toMatchObject({
        amount: 4200,
        refundPercent: 100,
        reason: RefundReason.LatePayment,
      });
      expect(refund.paymentId.toString()).toBe(body.id);

      const notification = await notifications
        .findOne({
          userId: new Types.ObjectId(owner.id),
          type: NotificationType.Refund,
          linkId: new Types.ObjectId(bookingId),
        })
        .lean()
        .orFail()
        .exec();
      expect(notification.linkType).toBe(NotificationLinkType.FlightBooking);

      const mine = await http()
        .get(`/api/refunds/${refund._id.toString()}`)
        .set('Cookie', owner.cookie);
      const theirs = await http()
        .get(`/api/refunds/${refund._id.toString()}`)
        .set('Cookie', stranger.cookie);
      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({
        bookingType: 'flight_change',
        bookingId: changeId,
        reason: 'late_payment',
      });
      expect(theirs.status).toBe(404);
    });
  });

  it('cancels a change payment whose hold ended, at Stripe and in the database, and touches no booking', async () => {
    const changeId = newChange();
    const { body } = await startedChangePayment(changeId);
    // Our own payment, by id: its hold ends now.
    await payments
      .updateOne(
        { _id: new Types.ObjectId(body.id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      )
      .exec();
    const confirmCalls = port.confirmPaid.mock.calls.length;
    const flightConfirm = jest.spyOn(
      app.get(FlightBookingsService),
      'confirmPaid',
    );

    // The app's own cron job may have cancelled it a moment before this call.
    await app.get(PaymentExpiryService).cancelDuePayments(new Date());

    expect((await storedPayment(body.id)).status).toBe(PaymentStatus.Cancelled);
    expect(gateway.cancelPaymentIntent).toHaveBeenCalledWith(
      body.stripePaymentIntentId,
    );
    expect(port.confirmPaid.mock.calls.length).toBe(confirmCalls);
    expect(flightConfirm).not.toHaveBeenCalled();
    flightConfirm.mockRestore();
  });

  describe('a fare difference refund and the remaining amount (PAY-03)', () => {
    it('refunds an exact amount from a real succeeded flight payment, then a cancellation takes its percent of the rest', async () => {
      const bookingId = await insertFlightPayment(25100);
      const changeId = new Types.ObjectId().toString();

      const fare = await refundsService.refundAmount({
        bookingType: BookingType.FlightChange,
        bookingId: changeId,
        paymentOf: { bookingType: BookingType.Flight, bookingId },
        amount: 4000,
        reason: RefundReason.FareDifference,
        link: { bookingType: BookingType.Flight, bookingId },
      });
      if (fare) refundIds.add(fare.id);
      const cancel = await refundsService.refund({
        bookingType: BookingType.Flight,
        bookingId,
        refundPercent: 50,
        reason: RefundReason.UserCancellation,
      });
      if (cancel) refundIds.add(cancel.id);

      expect(fare).toMatchObject({
        bookingType: 'flight_change',
        bookingId: changeId,
        amount: 4000,
        refundPercent: 16,
        reason: 'fare_difference',
        status: 'pending',
      });
      expect(fare?.stripeRefundId).toMatch(/^re_/);
      // (25100 - 4000) x 50% = 10550
      expect(cancel).toMatchObject({ amount: 10550, refundPercent: 50 });
      expect(fare?.paymentId).toBe(cancel?.paymentId);

      const notified = await notifications
        .findOne({
          userId: new Types.ObjectId(owner.id),
          linkId: new Types.ObjectId(bookingId),
          message: { $regex: /^Your new flight costs less/ },
        })
        .lean()
        .exec();
      expect(notified).not.toBeNull();

      const shown = await http()
        .get(`/api/refunds/${fare?.id}`)
        .set('Cookie', owner.cookie);
      expect(shown.status).toBe(200);
      expect(shown.body).toMatchObject({ reason: 'fare_difference' });
    });

    it('is idempotent per change and never refunds more than is left of the payment', async () => {
      const bookingId = await insertFlightPayment(10000);
      const first = new Types.ObjectId().toString();
      const second = new Types.ObjectId().toString();
      const ask = (changeId: string, amount: number) =>
        refundsService.refundAmount({
          bookingType: BookingType.FlightChange,
          bookingId: changeId,
          paymentOf: { bookingType: BookingType.Flight, bookingId },
          amount,
          reason: RefundReason.FareDifference,
        });

      const made = await ask(first, 6000);
      const again = await ask(first, 6000);
      if (made) refundIds.add(made.id);

      expect(again).toEqual(made);
      await expect(ask(second, 4001)).rejects.toThrow(
        REFUND_EXCEEDS_PAYMENT_MESSAGE,
      );
      const rest = await ask(second, 4000);
      if (rest) refundIds.add(rest.id);
      expect(rest).toMatchObject({ amount: 4000 });

      // A 100% cancellation now has nothing left to refund.
      await expect(
        refundsService.refund({
          bookingType: BookingType.Flight,
          bookingId,
          refundPercent: 100,
          reason: RefundReason.UserCancellation,
        }),
      ).resolves.toBeNull();

      // Money out never exceeds money in.
      const paymentId = new Types.ObjectId(made?.paymentId);
      const out = await refunds
        .find({ paymentId, status: { $ne: RefundStatus.Failed } })
        .lean()
        .exec();
      expect(out.reduce((sum, refund) => sum + refund.amount, 0)).toBe(10000);
    });

    it('reconciles a fare_difference refund from a signed refund.updated event', async () => {
      const bookingId = await insertFlightPayment(25100);
      const fare = await refundsService.refundAmount({
        bookingType: BookingType.FlightChange,
        bookingId: new Types.ObjectId().toString(),
        paymentOf: { bookingType: BookingType.Flight, bookingId },
        amount: 1500,
        reason: RefundReason.FareDifference,
      });
      if (!fare?.stripeRefundId) throw new Error('the refund was not sent');
      refundIds.add(fare.id);

      const eventId = `evt_${next()}`;
      eventIds.add(eventId);
      const payload = JSON.stringify({
        id: eventId,
        object: 'event',
        type: 'refund.updated',
        data: {
          object: {
            id: fare.stripeRefundId,
            object: 'refund',
            status: 'succeeded',
            amount: 1500,
            currency: 'usd',
            payment_intent: 'pi_any',
          },
        },
      });
      const response = await http()
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

      expect(response.status).toBe(200);
      expect(
        (await refunds.findById(fare.id).lean().orFail().exec()).status,
      ).toBe('refunded');
    });
  });

  describe('flight_change is not a booking', () => {
    it('answers 400 on the policy routes', async () => {
      const id = newChange();

      const read = await http()
        .get(`/api/bookings/flight_change/${id}/policies`)
        .set('Cookie', owner.cookie);
      const accept = await http()
        .post(`/api/bookings/flight_change/${id}/accept-policies`)
        .set('Cookie', owner.cookie)
        .send({ accepted: true });

      for (const response of [read, accept]) {
        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            {
              field: 'type',
              messages: ['type must be one of: flight, hotel'],
            },
          ]),
        );
      }
    });

    it('answers 400 on the admin booking list filter', async () => {
      const response = await http()
        .get('/api/admin/bookings?type=flight_change')
        .set('Cookie', admin.cookie);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('type');
    });

    it('lists booking types in Swagger: BookingType with flight_change, BookingKind without it', async () => {
      const response = await http().get('/api/docs-json');

      expect(response.status).toBe(200);
      const schemas = (
        response.body as {
          components: { schemas: Record<string, { enum?: string[] }> };
        }
      ).components.schemas;
      expect(schemas.BookingType.enum).toEqual([
        'flight',
        'hotel',
        'flight_change',
      ]);
      expect(schemas.BookingKind.enum).toEqual(['flight', 'hotel']);
      expect(schemas.RefundReason.enum).toContain('fare_difference');
    });
  });
});
