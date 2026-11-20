import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import type { Response } from 'superagent';
import { Types, type Model } from 'mongoose';
import { Role } from './../src/common/enums/role.enum';
import { FLIGHT_REFERENCE_PATTERN } from './../src/flight-bookings/booking-reference';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { E_TICKET_NOT_CONFIRMED_MESSAGE } from './../src/flight-bookings/flight-bookings.constants';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { NotificationLinkType } from './../src/notifications/enums/notification-link-type.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { Payment } from './../src/payments/models/payment.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
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

const MINUTE_MS = 60_000;
const PRICE = 25000;

interface PaymentBody {
  id: string;
  bookingId: string;
  stripePaymentIntentId: string;
  amount: number;
}

/**
 * Reads a binary response body (the PDF) as a Buffer. Supertest types the
 * parser's argument as its Response; in Node it is the HTTP response stream.
 */
const binary = (
  res: Response,
  callback: (error: Error | null, body: Buffer) => void,
): void => {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

/**
 * FLT-23 end to end, on the "-test" database: a real hold, accepted policies
 * and payment (PAY-02, PAY-01), then a webhook signed with the real Stripe
 * signature check confirms the booking. Only the three gateway calls that
 * would reach Stripe are replaced. Every record is deleted by id.
 */
describe('Flight booking confirmation (e2e, FLT-23)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let refunds: Model<Refund>;
  let users: Model<User>;
  let stranger: Actor;
  /** The signer of webhook events: the real Stripe SDK, offline. */
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
  const heldBooking = async (): Promise<{ id: string; flightId: string }> => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ price: PRICE })],
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
            fullName: 'Confirm Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'CONF12345',
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

  const startPayment = async (bookingId: string): Promise<PaymentBody> => {
    const response = await fx
      .http()
      .post('/api/payments')
      .set('Cookie', fx.user.cookie)
      .send({ bookingType: 'flight', bookingId });
    expect(response.status).toBe(201);
    const body = response.body as PaymentBody;
    paymentIds.add(body.id);
    return body;
  };

  /** Sends `payment_intent.succeeded` for the payment, signed with the test secret. */
  const paid = (
    payment: PaymentBody,
    eventId = `evt_${fx.run}_${++counter}`,
  ) => {
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
    eventIds.add(eventId);
    return fx
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
  };

  const storedBooking = (id: string) =>
    flightBookings.findById(id).lean().orFail().exec();

  const cabinOf = async (flightId: string) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    return flight.cabins[0];
  };

  const notificationsOf = (bookingId: string) =>
    notifications.find({ userId: fx.user.id, linkId: bookingId }).lean().exec();

  const eTicket = (id: string, actor?: Actor) => {
    const call = fx.http().get(`/api/flight-bookings/${id}/e-ticket`);
    return (actor ? call.set('Cookie', actor.cookie) : call)
      .buffer(true)
      .parse(binary);
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt23');
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
    refunds = fx.app.get<Model<Refund>>(getModelToken(Refund.name));
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
  });

  /**
   * PAY-03: a late payment is refunded through Stripe. The refund call is
   * replaced in every test, so no request reaches Stripe with the fake key.
   * PaymentsModule and RefundsModule share one StripeGateway, so this one spy
   * covers the webhook and the refunds service.
   */
  let createRefund: jest.SpiedFunction<StripeGateway['createRefund']>;

  beforeEach(() => {
    createRefund = jest
      .spyOn(fx.app.get(StripeGateway), 'createRefund')
      .mockImplementation((refund) =>
        Promise.resolve<GatewayRefund>({
          id: `re_test_${fx.run}_${++counter}`,
          status: 'succeeded',
          amount: refund.amount,
          currency: 'usd',
          paymentIntentId: refund.paymentIntentId,
        }),
      );
  });

  afterEach(() => {
    createRefund.mockRestore();
  });

  /** The refunds of one booking (at most one, unique per booking). */
  const refundsOf = (bookingId: string) =>
    refunds
      .find({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(bookingId),
      })
      .lean()
      .exec();

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
      // PAY-03: the refunds of the late payments, one by one by id.
      for (const id of bookingIds) {
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

  it('confirms the booking after a verified payment: a reference, booked seats, one notification and an e-ticket', async () => {
    const booking = await heldBooking();
    expect(await cabinOf(booking.flightId)).toMatchObject({
      heldSeats: 1,
      bookedSeats: 0,
    });
    const payment = await startPayment(booking.id);

    const webhook = await paid(payment);

    expect(webhook.status).toBe(200);
    const stored = await storedBooking(booking.id);
    expect(stored.status).toBe(FlightBookingStatus.Confirmed);
    expect(stored.reference).toMatch(FLIGHT_REFERENCE_PATTERN);
    // Held seats became booked seats: the seats left did not change.
    expect(await cabinOf(booking.flightId)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 1,
    });

    const sent = await notificationsOf(booking.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: NotificationType.BookingConfirmed,
      linkType: NotificationLinkType.FlightBooking,
    });
    expect(sent[0].message).toContain(stored.reference);
    expect(sent[0].message).toContain(
      `${fx.airports.departure} to ${fx.airports.arrival}`,
    );
    expect(sent[0].message).not.toContain('CONF12345');

    const ticket = await eTicket(booking.id, fx.user);
    expect(ticket.status).toBe(200);
    expect(ticket.headers['content-type']).toBe('application/pdf');
    expect(ticket.headers['content-disposition']).toBe(
      `attachment; filename="e-ticket-${stored.reference}.pdf"`,
    );
    const pdf = ticket.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('changes nothing when the same payment is reported again, by the same event or a new one', async () => {
    const booking = await heldBooking();
    const payment = await startPayment(booking.id);
    const eventId = `evt_${fx.run}_repeat_${booking.id}`;
    await paid(payment, eventId);
    const first = await storedBooking(booking.id);

    const sameEvent = await paid(payment, eventId);
    const newEvent = await paid(payment);

    expect(sameEvent.status).toBe(200);
    expect(newEvent.status).toBe(200);
    const after = await storedBooking(booking.id);
    expect(after.status).toBe(FlightBookingStatus.Confirmed);
    expect(after.reference).toBe(first.reference);
    expect(await cabinOf(booking.flightId)).toMatchObject({
      heldSeats: 0,
      bookedSeats: 1,
    });
    expect(await notificationsOf(booking.id)).toHaveLength(1);
  });

  it('does not confirm a payment that arrives after the hold ended: no reference, no booked seat', async () => {
    const booking = await heldBooking();
    const payment = await startPayment(booking.id);
    // The hold ends before Stripe reports the payment (this suite's own booking).
    await flightBookings
      .updateOne(
        { _id: booking.id },
        { $set: { holdExpiresAt: new Date(Date.now() - MINUTE_MS) } },
      )
      .exec();

    const webhook = await paid(payment);

    expect(webhook.status).toBe(200);
    const stored = await storedBooking(booking.id);
    expect(stored.status).not.toBe(FlightBookingStatus.Confirmed);
    expect(stored.reference).toBeUndefined();
    expect((await cabinOf(booking.flightId)).bookedSeats).toBe(0);
    // PAY-03: the late payment is refunded in full instead.
    const sent = await notificationsOf(booking.id);
    expect(
      sent.filter((n) => n.type === NotificationType.BookingConfirmed),
    ).toHaveLength(0);
    expect(sent.filter((n) => n.type === NotificationType.Refund)).toHaveLength(
      1,
    );
    const [refund, ...others] = await refundsOf(booking.id);
    expect(others).toHaveLength(0);
    expect(refund).toMatchObject({
      refundPercent: 100,
      reason: RefundReason.LatePayment,
      amount: payment.amount,
      // The stub answers `succeeded`, which is a refunded refund.
      status: RefundStatus.Refunded,
    });
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][1]).toBe(`refund-flight-${booking.id}`);

    // The same payment reported again, with a new event id: no second refund.
    const again = await paid(payment);
    expect(again.status).toBe(200);
    expect(await refundsOf(booking.id)).toHaveLength(1);
    expect(
      (await notificationsOf(booking.id)).filter(
        (n) => n.type === NotificationType.Refund,
      ),
    ).toHaveLength(1);
    expect(createRefund).toHaveBeenCalledTimes(1);
  });

  describe('GET /api/flight-bookings/:id/e-ticket', () => {
    it('answers 404 to another user, like a booking that does not exist', async () => {
      const booking = await heldBooking();
      await paid(await startPayment(booking.id));

      const response = await eTicket(booking.id, stranger);

      expect(response.status).toBe(404);
    });

    it('answers 409 while the booking waits for payment', async () => {
      const booking = await heldBooking();

      const response = await eTicket(booking.id, fx.user);

      expect(response.status).toBe(409);
      expect(
        (
          JSON.parse((response.body as Buffer).toString('utf8')) as {
            message: string;
          }
        ).message,
      ).toBe(E_TICKET_NOT_CONFIRMED_MESSAGE);
    });

    it('answers 401 to a guest, 403 to other roles and 400 to a bad id', async () => {
      const booking = await heldBooking();

      expect((await eTicket(booking.id)).status).toBe(401);
      expect((await eTicket(booking.id, fx.admin)).status).toBe(403);
      expect((await eTicket(booking.id, fx.moderator)).status).toBe(403);
      expect((await eTicket('not-an-id', fx.user)).status).toBe(400);
    });

    it('is documented in Swagger as a PDF', async () => {
      const response = await fx.http().get('/api/docs-json');
      const route = (
        response.body as {
          paths: Record<
            string,
            { get?: { responses: Record<string, unknown> } }
          >;
        }
      ).paths['/api/flight-bookings/{id}/e-ticket'];

      expect(route?.get?.responses).toMatchObject({
        200: { content: { 'application/pdf': expect.anything() as unknown } },
        401: expect.anything() as unknown,
        404: expect.anything() as unknown,
        409: expect.anything() as unknown,
      });
    });
  });
});
