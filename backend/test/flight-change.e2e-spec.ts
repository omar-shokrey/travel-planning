import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { Role } from './../src/common/enums/role.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FlightChangeStatus } from './../src/flight-bookings/enums/flight-change-status.enum';
import {
  CHANGE_DIFFERENCE_CHANGED_MESSAGE,
  CHANGE_IN_PROGRESS_MESSAGE,
  CHANGE_NOT_CONFIRMED_MESSAGE,
  FLIGHT_CHANGE_STUCK_AFTER_MS,
  POLICIES_REQUIRED_MESSAGE,
  SAME_FLIGHT_MESSAGE,
  changeRouteMessage,
} from './../src/flight-bookings/flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/flight-bookings/flight-bookings.service';
import { FlightChangeExpiryService } from './../src/flight-bookings/flight-change-expiry.service';
import { FlightChangeService } from './../src/flight-bookings/flight-change.service';
import { FlightBookingChange } from './../src/flight-bookings/models/flight-booking-change.schema';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { FlightSeatAssignment } from './../src/flight-bookings/models/flight-seat-assignment.schema';
import {
  FlightSeatHoldsService,
  NOT_ENOUGH_SEATS_MESSAGE,
} from './../src/flights/flight-seat-holds.service';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { RefundsService } from './../src/payments/refunds/refunds.service';
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
/** The fixture airline's tiers, copied into each booking and each change (PAY-02). */
const TIERS = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 3, refundPercent: 50 },
];

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

interface ChangeBody {
  id: string | null;
  bookingId: string;
  status: string;
  difference: number;
  newTotal: number;
  holdExpiresAt: string | null;
  payment: { bookingType: string; bookingId: string } | null;
  refund: { id: string; amount: number; status: string } | null;
}

/**
 * FLT-27 end to end, on the "-test" database: bookings confirmed through the
 * real hold, policies, payment and signed webhook (FLT-23), then changed
 * through PATCH /api/flight-bookings/:id/change-flight: a dry run, an equal,
 * a cheaper and a dearer flight (paid through POST /api/payments with
 * `flight_change` and the webhook), the hold expiry and a late payment, the
 * concurrency of two changes, cancellations after a change (FLT-26, FLT-06),
 * and the seat counters of every flight after each. Only the Stripe calls
 * are replaced. Every record is deleted by id.
 */
describe('Flight change (e2e, FLT-27)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let changes: Model<FlightBookingChange>;
  let seatAssignments: Model<FlightSeatAssignment>;
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

  /** A flight on the fixture's route (or another), with one economy cabin. */
  const newFlight = (
    price: number,
    options: {
      days?: number;
      seats?: number;
      airline?: string;
      reversed?: boolean;
    } = {},
  ) =>
    fx.insertFlight({
      departureAt: new Date(Date.now() + (options.days ?? 30) * DAY_MS),
      airlineId: options.airline,
      ...(options.reversed && {
        departureAirport: fx.airports.arrival,
        arrivalAirport: fx.airports.departure,
      }),
      cabins: [fx.storedCabin({ price, totalSeats: options.seats ?? 100 })],
    });

  const sendEvent = async (
    type: string,
    intent: { id: string; amount: number },
  ) => {
    const eventId = `evt_${fx.run}_${++counter}`;
    eventIds.add(eventId);
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type,
      data: {
        object: {
          id: intent.id,
          object: 'payment_intent',
          amount: intent.amount,
          amount_received: intent.amount,
          currency: 'usd',
        },
      },
    });
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

  /** Starts a payment (booking or change) and remembers it for cleanup. */
  const pay = async (bookingType: string, bookingId: string) => {
    const started = await fx
      .http()
      .post('/api/payments')
      .set('Cookie', fx.user.cookie)
      .send({ bookingType, bookingId });
    expect(started.status).toBe(201);
    const payment = started.body as PaymentBody;
    paymentIds.add(payment.id);
    return payment;
  };

  /** A booking confirmed by a verified payment (FLT-23), on a new flight. */
  const confirmedBooking = async (
    flightId?: string,
  ): Promise<{ id: string; flightId: string }> => {
    const flight = flightId ?? (await newFlight(PRICE));
    const hold = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send({
        flightId: flight,
        cabin: CabinClass.Economy,
        passengers: [
          {
            fullName: 'Change Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'CHNG12345',
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
    const payment = await pay('flight', id);
    const webhook = await sendEvent('payment_intent.succeeded', {
      id: payment.stripePaymentIntentId,
      amount: payment.amount,
    });
    expect(webhook.status).toBe(200);
    expect((await storedBooking(id)).status).toBe(
      FlightBookingStatus.Confirmed,
    );
    return { id, flightId: flight };
  };

  const changeFlight = (
    bookingId: string,
    body: Record<string, unknown>,
    actor: Actor | null = fx.user,
  ) => {
    const call = fx
      .http()
      .patch(`/api/flight-bookings/${bookingId}/change-flight`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(body);
  };

  /** A dry run, then the change with the difference it showed. */
  const changeTo = async (bookingId: string, newFlightId: string) => {
    const dry = await changeFlight(bookingId, { newFlightId, dryRun: true });
    expect(dry.status).toBe(200);
    const { difference } = dry.body as ChangeBody;
    const made = await changeFlight(bookingId, {
      newFlightId,
      expectedDifference: difference,
      policiesAccepted: true,
    });
    return made;
  };

  const storedBooking = (id: string) =>
    flightBookings.findById(id).lean().orFail().exec();

  const cabinOf = async (flightId: string) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    const { bookedSeats, heldSeats } = flight.cabins[0];
    return { bookedSeats, heldSeats };
  };

  const changesOf = (bookingId: string) =>
    changes
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

  const refundOfChange = (changeId: string) =>
    refunds
      .findOne({
        bookingType: BookingType.FlightChange,
        bookingId: new Types.ObjectId(changeId),
      })
      .lean()
      .exec();

  beforeAll(async () => {
    fx = await createFlightFixture('flt27');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    changes = fx.app.get<Model<FlightBookingChange>>(
      getModelToken(FlightBookingChange.name),
    );
    seatAssignments = fx.app.get<Model<FlightSeatAssignment>>(
      getModelToken(FlightSeatAssignment.name),
    );
    // One open change per booking is a unique index: make sure it exists.
    await changes.init();
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    refunds = fx.app.get<Model<Refund>>(getModelToken(Refund.name));
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));

    for (const airline of [fx.airlineId, fx.otherAirlineId]) {
      await fx.airlines
        .updateOne(
          { _id: airline },
          { $set: { 'policy.cancellationTiers': TIERS } },
        )
        .exec();
    }

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
        const ours = await changesOf(id);
        const keys = [id, ...ours.map((change) => change._id.toString())];
        for (const key of keys) {
          const found = await refunds
            .find({ bookingId: new Types.ObjectId(key) })
            .select('_id')
            .lean()
            .exec();
          for (const { _id } of found) {
            await refunds.findByIdAndDelete(_id).exec();
          }
          const paid = await payments
            .find({ bookingId: new Types.ObjectId(key) })
            .select('_id')
            .lean()
            .exec();
          for (const { _id } of paid) paymentIds.add(_id.toString());
        }
        const notes = await notifications
          .find({ linkId: id })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of notes) {
          await notifications.findByIdAndDelete(_id).exec();
        }
        for (const change of ours) {
          await changes.findByIdAndDelete(change._id).exec();
        }
        const seats = await seatAssignments
          .find({ bookingId: new Types.ObjectId(id) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of seats) {
          await seatAssignments.findByIdAndDelete(_id).exec();
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

  describe('the dry run and the rules', () => {
    it('quotes the difference and the new policies, and changes nothing', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 4200, {
        days: 31,
        airline: fx.otherAirlineId,
      });

      const response = await changeFlight(booking.id, {
        newFlightId: to,
        dryRun: true,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: null,
        bookingId: booking.id,
        status: 'quote',
        segmentIndex: 0,
        cabin: CabinClass.Economy,
        oldSegmentTotal: PRICE,
        newSegmentTotal: PRICE + 4200,
        difference: 4200,
        newTotal: PRICE + 4200,
        currency: 'USD',
        holdExpiresAt: null,
        payment: null,
        refund: null,
        newPolicies: { flightId: to, cancellationTiers: TIERS },
      });
      expect((response.body as { toFlight: { id: string } }).toFlight.id).toBe(
        to,
      );
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
      expect(await changesOf(booking.id)).toHaveLength(0);
      expect((await storedBooking(booking.id)).total).toBe(PRICE);
    });

    it('answers 400 for the flight already booked, another route, and a change without accepted policies', async () => {
      const booking = await confirmedBooking();
      const reversed = await newFlight(PRICE, { reversed: true, days: 31 });
      const to = await newFlight(PRICE, { days: 31 });

      const same = await changeFlight(booking.id, {
        newFlightId: booking.flightId,
        dryRun: true,
      });
      const route = await changeFlight(booking.id, {
        newFlightId: reversed,
        dryRun: true,
      });
      const policies = await changeFlight(booking.id, {
        newFlightId: to,
        expectedDifference: 0,
      });
      const extra = await changeFlight(booking.id, {
        newFlightId: to,
        dryRun: true,
        cabin: 'business',
      });

      expect(same.status).toBe(400);
      expect(same.body.errors).toEqual([
        { field: 'newFlightId', messages: [SAME_FLIGHT_MESSAGE] },
      ]);
      expect(route.status).toBe(400);
      expect(route.body.errors).toEqual([
        {
          field: 'newFlightId',
          messages: [
            changeRouteMessage(fx.airports.departure, fx.airports.arrival),
          ],
        },
      ]);
      expect(policies.status).toBe(400);
      expect(policies.body.errors).toEqual([
        { field: 'policiesAccepted', messages: [POLICIES_REQUIRED_MESSAGE] },
      ]);
      expect(extra.status).toBe(400);
      expect(await changesOf(booking.id)).toHaveLength(0);
    });

    it("answers 404 for another user's booking, 403 for staff and 401 for a guest, and changes nothing", async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 31 });
      const body = {
        newFlightId: to,
        expectedDifference: 0,
        policiesAccepted: true,
      };

      const other = await changeFlight(booking.id, body, stranger);
      const admin = await changeFlight(booking.id, body, fx.admin);
      const moderator = await changeFlight(booking.id, body, fx.moderator);
      const guest = await changeFlight(booking.id, body, null);

      expect(other.status).toBe(404);
      expect(other.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
      expect(admin.status).toBe(403);
      expect(moderator.status).toBe(403);
      expect(guest.status).toBe(401);
      expect(await changesOf(booking.id)).toHaveLength(0);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
    });

    it('answers 409 for a booking that is not confirmed, and for a difference other than the one shown', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 100, { days: 31 });
      const held = await fx
        .http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', fx.user.cookie)
        .send({
          flightId: to,
          cabin: CabinClass.Economy,
          passengers: [
            {
              fullName: 'Change Test Held',
              dateOfBirth: '1990-01-01',
              passportNumber: 'CHNG54321',
            },
          ],
        });
      bookingIds.add((held.body as { id: string }).id);

      const pending = await changeFlight((held.body as { id: string }).id, {
        newFlightId: booking.flightId,
        dryRun: true,
      });
      const moved = await changeFlight(booking.id, {
        newFlightId: to,
        expectedDifference: 99,
        policiesAccepted: true,
      });

      expect(pending.status).toBe(409);
      expect(pending.body.message).toBe(CHANGE_NOT_CONFIRMED_MESSAGE);
      expect(moved.status).toBe(409);
      expect(moved.body.message).toBe(CHANGE_DIFFERENCE_CHANGED_MESSAGE);
      expect(await changesOf(booking.id)).toHaveLength(0);
    });
  });

  describe('an equal or cheaper flight changes at once', () => {
    it('moves the seats, swaps the flight, keeps the total, notifies, and shows the change on the details', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 32 });

      const response = await changeTo(booking.id, to);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: FlightChangeStatus.Completed,
        difference: 0,
        newTotal: PRICE,
        refund: null,
      });
      const stored = await storedBooking(booking.id);
      expect(stored.segments[0].flightId.toString()).toBe(to);
      expect(stored.total).toBe(PRICE);
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      expect(
        await notifications.countDocuments({
          linkId: new Types.ObjectId(booking.id),
          type: NotificationType.FlightChanged,
        }),
      ).toBe(1);

      const details = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}`)
        .set('Cookie', fx.user.cookie);
      expect(details.status).toBe(200);
      expect(details.body).toMatchObject({
        pendingChange: null,
        changes: [
          {
            id: (response.body as ChangeBody).id,
            status: FlightChangeStatus.Completed,
            fromFlightId: booking.flightId,
            toFlightId: to,
            difference: 0,
          },
        ],
      });
    });

    it('refunds a cheaper flight the exact difference from the booking payment', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE - 4000, { days: 32 });

      const response = await changeTo(booking.id, to);

      expect(response.status).toBe(200);
      const body = response.body as ChangeBody;
      expect(body).toMatchObject({
        status: FlightChangeStatus.Completed,
        difference: -4000,
        newTotal: PRICE - 4000,
        refund: { amount: 4000, status: RefundStatus.Pending },
      });
      const refund = await refundOfChange(body.id as string);
      expect(refund).toMatchObject({
        amount: 4000,
        reason: RefundReason.FareDifference,
      });
      const original = await payments
        .findOne({ bookingId: new Types.ObjectId(booking.id) })
        .lean()
        .orFail()
        .exec();
      expect(refund?.paymentId.toString()).toBe(original._id.toString());
      expect((await storedBooking(booking.id)).total).toBe(PRICE - 4000);
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });

      const shown = await fx
        .http()
        .get(`/api/refunds/${refund?._id.toString()}`)
        .set('Cookie', fx.user.cookie);
      expect(shown.status).toBe(200);
    });
  });

  describe('a dearer flight is paid first', () => {
    it('holds the new seats, takes the payment of the difference, then swaps on the webhook', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 4200, { days: 32 });

      const response = await changeTo(booking.id, to);

      expect(response.status).toBe(200);
      const body = response.body as ChangeBody;
      expect(body).toMatchObject({
        status: FlightChangeStatus.PendingPayment,
        difference: 4200,
        payment: { bookingType: 'flight_change', bookingId: body.id },
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 1 });
      expect(
        (await storedBooking(booking.id)).segments[0].flightId.toString(),
      ).toBe(booking.flightId);
      const details = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}`)
        .set('Cookie', fx.user.cookie);
      expect(details.body.pendingChange).toMatchObject({
        id: body.id,
        status: FlightChangeStatus.PendingPayment,
      });

      const payment = await pay('flight_change', body.id as string);
      expect(payment.amount).toBe(4200);
      const webhook = await sendEvent('payment_intent.succeeded', {
        id: payment.stripePaymentIntentId,
        amount: 4200,
      });

      expect(webhook.status).toBe(200);
      const [stored] = await changesOf(booking.id);
      expect(stored.status).toBe(FlightChangeStatus.Completed);
      const after = await storedBooking(booking.id);
      expect(after.segments[0].flightId.toString()).toBe(to);
      expect(after.total).toBe(PRICE + 4200);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });

    it('refunds in full a payment that arrives after the hold ended, and the job then gives the held seats back', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 1000, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;
      const payment = await pay('flight_change', body.id as string);

      // Our own change and payment, by id: their hold ends now.
      const ended = new Date(Date.now() - 1000);
      await changes
        .updateOne({ _id: body.id }, { $set: { holdExpiresAt: ended } })
        .exec();
      await payments
        .updateOne({ _id: payment.id }, { $set: { holdExpiresAt: ended } })
        .exec();
      const late = await sendEvent('payment_intent.succeeded', {
        id: payment.stripePaymentIntentId,
        amount: 1000,
      });
      // The app's own job may have expired it a moment before this call.
      await fx.app.get(FlightChangeExpiryService).run(new Date());

      expect(late.status).toBe(200);
      const [stored] = await changesOf(booking.id);
      expect(stored.status).toBe(FlightChangeStatus.Expired);
      expect(
        (await storedBooking(booking.id)).segments[0].flightId.toString(),
      ).toBe(booking.flightId);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
      expect(await refundOfChange(body.id as string)).toMatchObject({
        amount: 1000,
        refundPercent: 100,
        reason: RefundReason.LatePayment,
      });
    });

    it('lets only the owner pay a change: another user gets 404 and no payment is made', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 900, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;

      const response = await fx
        .http()
        .post('/api/payments')
        .set('Cookie', stranger.cookie)
        .send({ bookingType: 'flight_change', bookingId: body.id });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
      expect(
        await payments.countDocuments({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(body.id as string),
        }),
      ).toBe(0);
    });

    it('lets one change at a time per booking, and a cabin never gives more seats than it has', async () => {
      const first = await confirmedBooking();
      const second = await confirmedBooking();
      const to = await newFlight(PRICE + 500, { days: 33, seats: 1 });
      const body = {
        newFlightId: to,
        expectedDifference: 500,
        policiesAccepted: true,
      };

      const [a, b] = await Promise.all([
        changeFlight(first.id, body),
        changeFlight(first.id, body),
      ]);
      const other = await changeFlight(second.id, body);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        [a, b].find((response) => response.status === 409)?.body.message,
      ).toBe(CHANGE_IN_PROGRESS_MESSAGE);
      expect(other.status).toBe(409);
      expect(other.body.message).toBe(NOT_ENOUGH_SEATS_MESSAGE);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 1 });
      expect(await cabinOf(first.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
      expect(await cabinOf(second.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
      const open = (await changesOf(first.id)).filter((c) => c.open);
      expect(open).toHaveLength(1);
    });
  });

  describe('after a change', () => {
    it('changes a booking again, and the counters of every flight stay exact', async () => {
      const booking = await confirmedBooking();
      const second = await newFlight(PRICE, { days: 34 });
      const third = await newFlight(PRICE - 1000, { days: 35 });

      expect((await changeTo(booking.id, second)).status).toBe(200);
      expect((await changeTo(booking.id, third)).status).toBe(200);

      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(second)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(third)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      expect(await changesOf(booking.id)).toHaveLength(2);
    });

    it('cancels (FLT-26) with the refund of every payment, never more than was paid', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 4200, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;
      const payment = await pay('flight_change', body.id as string);
      await sendEvent('payment_intent.succeeded', {
        id: payment.stripePaymentIntentId,
        amount: 4200,
      });

      const preview = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}/cancel`)
        .set('Cookie', fx.user.cookie);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        refundPercent: 100,
        total: PRICE + 4200,
        refundAmount: PRICE + 4200,
      });
      const cancelled = await fx
        .http()
        .post(`/api/flight-bookings/${booking.id}/cancel`)
        .set('Cookie', fx.user.cookie)
        .send({ expectedRefundPercent: 100 });

      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        refund: { amount: PRICE },
        changeRefunds: [{ amount: 4200 }],
      });
      const refunded =
        (cancelled.body.refund as { amount: number }).amount +
        (cancelled.body.changeRefunds as { amount: number }[]).reduce(
          (sum, refund) => sum + refund.amount,
          0,
        );
      expect(refunded).toBe(preview.body.refundAmount);
      expect(refunded).toBeLessThanOrEqual(PRICE + 4200);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });

    it('answers 409 to the cancellation preview and the cancellation while a change is being applied, and cancels nothing', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 600, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;
      const id = new Types.ObjectId(body.id as string);
      // The moment between the payment and the end of the swap.
      await changes
        .updateOne(
          { _id: id },
          { $set: { status: FlightChangeStatus.Applying } },
        )
        .exec();

      try {
        const preview = await fx
          .http()
          .get(`/api/flight-bookings/${booking.id}/cancel`)
          .set('Cookie', fx.user.cookie);
        const cancelled = await fx
          .http()
          .post(`/api/flight-bookings/${booking.id}/cancel`)
          .set('Cookie', fx.user.cookie)
          .send({ expectedRefundPercent: 100 });

        expect(preview.status).toBe(409);
        expect(preview.body.message).toBe(CHANGE_IN_PROGRESS_MESSAGE);
        expect(cancelled.status).toBe(409);
        expect(cancelled.body.message).toBe(CHANGE_IN_PROGRESS_MESSAGE);
        expect((await storedBooking(booking.id)).status).toBe(
          FlightBookingStatus.Confirmed,
        );
        expect(
          await refunds.countDocuments({
            bookingId: new Types.ObjectId(booking.id),
          }),
        ).toBe(0);
      } finally {
        // Back to waiting for payment, so the hold ends as usual.
        await changes
          .updateOne(
            { _id: id },
            { $set: { status: FlightChangeStatus.PendingPayment } },
          )
          .exec();
      }
    });

    it('previews exactly what POST refunds at the 50% tier after a cheaper change, each payment rounded', async () => {
      const from = await newFlight(PRICE, { days: 10 });
      const booking = await confirmedBooking(from);
      const to = await newFlight(PRICE - 999, { days: 11 });
      expect((await changeTo(booking.id, to)).status).toBe(200);

      const preview = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}/cancel`)
        .set('Cookie', fx.user.cookie);
      const cancelled = await fx
        .http()
        .post(`/api/flight-bookings/${booking.id}/cancel`)
        .set('Cookie', fx.user.cookie)
        .send({ expectedRefundPercent: 50 });

      // The payment of 25000 still holds 24001: 50% of it is 12000.5 -> 12001.
      expect(preview.body).toMatchObject({
        refundPercent: 50,
        total: PRICE - 999,
        refundAmount: 12_001,
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        refund: { amount: 12_001 },
        changeRefunds: [],
      });
      const original = await payments
        .findOne({ bookingId: new Types.ObjectId(booking.id) })
        .lean()
        .orFail()
        .exec();
      const out = await refunds.find({ paymentId: original._id }).lean().exec();
      // 999 for the cheaper fare, 12001 for the cancellation: never more than 25000.
      expect(out.reduce((sum, refund) => sum + refund.amount, 0)).toBe(13_000);
      expect(await cabinOf(from)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
    });

    it('frees the seat chosen on the changed flight (FLT-28)', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 32 });
      const chosen = await fx
        .http()
        .patch(`/api/flight-bookings/${booking.id}/seat`)
        .set('Cookie', fx.user.cookie)
        .send({ seats: [{ passengerIndex: 0, seatNumber: '1A' }] });
      expect(chosen.status).toBe(200);

      expect((await changeTo(booking.id, to)).status).toBe(200);

      const details = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}`)
        .set('Cookie', fx.user.cookie);
      expect(details.body.seats).toEqual([
        {
          segmentIndex: 0,
          flightId: to,
          cabin: CabinClass.Economy,
          passengers: [{ passengerIndex: 0, seatNumber: null }],
        },
      ]);
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
    });

    it('expires an open change when the booking is cancelled, and gives its held seats back', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 700, { days: 32 });
      expect((await changeTo(booking.id, to)).status).toBe(200);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 1 });

      const cancelled = await fx
        .http()
        .post(`/api/flight-bookings/${booking.id}/cancel`)
        .set('Cookie', fx.user.cookie)
        .send({ expectedRefundPercent: 100 });

      expect(cancelled.status).toBe(200);
      const [change] = await changesOf(booking.id);
      expect(change.status).toBe(FlightChangeStatus.Expired);
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });

    it('refunds every payment in full when the airline cancels the new flight (FLT-06)', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 300, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;
      const payment = await pay('flight_change', body.id as string);
      await sendEvent('payment_intent.succeeded', {
        id: payment.stripePaymentIntentId,
        amount: 300,
      });

      const response = await fx
        .http()
        .post(`/api/flights/${to}/cancel`)
        .set('Cookie', fx.moderator.cookie);

      expect(response.status).toBe(200);
      expect((await storedBooking(booking.id)).status).toBe(
        FlightBookingStatus.Cancelled,
      );
      const original = await refunds
        .findOne({
          bookingType: BookingType.Flight,
          bookingId: new Types.ObjectId(booking.id),
        })
        .lean()
        .exec();
      expect(original).toMatchObject({ amount: PRICE, refundPercent: 100 });
      expect(await refundOfChange(body.id as string)).toMatchObject({
        amount: 300,
        refundPercent: 100,
        reason: RefundReason.FlightCancelled,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });
  });

  describe('at the same moment, and the retries of the change job', () => {
    it('gives the last seat of a flight to one of two users changing to it at once', async () => {
      const first = await confirmedBooking();
      const second = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 33, seats: 1 });
      const body = {
        newFlightId: to,
        expectedDifference: 0,
        policiesAccepted: true,
      };

      const answers = await Promise.all([
        changeFlight(first.id, body),
        changeFlight(second.id, body),
      ]);

      expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
      expect(answers.find((a) => a.status === 409)?.body.message).toBe(
        NOT_ENOUGH_SEATS_MESSAGE,
      );
      const winner = answers[0].status === 200 ? first : second;
      const loser = winner === first ? second : first;
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      expect(await cabinOf(winner.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(loser.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });
    });

    it('keeps the seats exact when a change and a cancellation of one booking race', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 32 });

      const [changed, cancelled] = await Promise.all([
        changeFlight(booking.id, {
          newFlightId: to,
          expectedDifference: 0,
          policiesAccepted: true,
        }),
        fx
          .http()
          .post(`/api/flight-bookings/${booking.id}/cancel`)
          .set('Cookie', fx.user.cookie)
          .send({ expectedRefundPercent: 100 }),
      ]);

      const stored = await storedBooking(booking.id);
      const onNew = stored.segments[0].flightId.toString() === to;
      const zero = { bookedSeats: 0, heldSeats: 0 };
      const one = { bookedSeats: 1, heldSeats: 0 };
      if (stored.status === FlightBookingStatus.Cancelled) {
        // Cancelled, on whichever flight it was on: no seat stays booked.
        expect(cancelled.status).toBe(200);
        expect(await cabinOf(booking.flightId)).toEqual(zero);
        expect(await cabinOf(to)).toEqual(zero);
      } else {
        // The change won: the cancellation saw it and answered 409.
        expect(changed.status).toBe(200);
        expect(cancelled.status).toBe(409);
        expect(onNew).toBe(true);
        expect(await cabinOf(booking.flightId)).toEqual(zero);
        expect(await cabinOf(to)).toEqual(one);
      }
      // Never more refunded than was paid.
      const refunded = await refunds
        .find({ bookingId: new Types.ObjectId(booking.id) })
        .lean()
        .exec();
      expect(
        refunded.reduce((sum, refund) => sum + refund.amount, 0),
      ).toBeLessThanOrEqual(PRICE);
    });

    it('keeps the seats exact when the payment of a change and the end of its hold race', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE + 600, { days: 32 });
      const body = (await changeTo(booking.id, to)).body as ChangeBody;
      const [stored] = await changesOf(booking.id);
      const holdEnd = (stored.holdExpiresAt as Date).getTime();
      const service = fx.app.get(FlightChangeService);

      // The webhook a moment before the hold ends, the job a moment after.
      const [applied] = await Promise.all([
        service.confirmPaid(body.id as string, new Date(holdEnd - 1)),
        service.expireDueHolds(new Date(holdEnd + 1)),
      ]);

      const [after] = await changesOf(booking.id);
      if (applied) {
        expect(after.status).toBe(FlightChangeStatus.Completed);
        expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
        expect(await cabinOf(booking.flightId)).toEqual({
          bookedSeats: 0,
          heldSeats: 0,
        });
      } else {
        expect(after.status).toBe(FlightChangeStatus.Expired);
        expect(await cabinOf(to)).toEqual({ bookedSeats: 0, heldSeats: 0 });
        expect(await cabinOf(booking.flightId)).toEqual({
          bookedSeats: 1,
          heldSeats: 0,
        });
      }
    });

    it('gives the old seats back through the job when the first try failed, once', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE, { days: 32 });
      const holds = fx.app.get(FlightSeatHoldsService);
      jest
        .spyOn(holds, 'unbook')
        .mockRejectedValueOnce(new Error('database down for this test'));

      const response = await changeTo(booking.id, to);
      expect(response.body).toMatchObject({ status: 'applying' });
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 1,
        heldSeats: 0,
      });

      await fx.app
        .get(FlightChangeExpiryService)
        .run(new Date(Date.now() + FLIGHT_CHANGE_STUCK_AFTER_MS + 1000));

      const [change] = await changesOf(booking.id);
      expect(change.status).toBe(FlightChangeStatus.Completed);
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      jest.mocked(holds.unbook).mockRestore();
    });

    it('makes the refund of a cheaper flight through the job when the first try failed', async () => {
      const booking = await confirmedBooking();
      const to = await newFlight(PRICE - 1500, { days: 32 });
      const refundsService = fx.app.get(RefundsService);
      jest
        .spyOn(refundsService, 'refundAmount')
        .mockRejectedValueOnce(new Error('database down for this test'));

      const response = await changeTo(booking.id, to);
      const id = (response.body as ChangeBody).id as string;
      expect(response.body).toMatchObject({ status: 'applying' });
      expect(await refundOfChange(id)).toBeNull();

      await fx.app
        .get(FlightChangeExpiryService)
        .run(new Date(Date.now() + FLIGHT_CHANGE_STUCK_AFTER_MS + 1000));

      expect(await refundOfChange(id)).toMatchObject({
        amount: 1500,
        reason: RefundReason.FareDifference,
      });
      const [change] = await changesOf(booking.id);
      expect(change.status).toBe(FlightChangeStatus.Completed);
      expect(await cabinOf(booking.flightId)).toEqual({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(to)).toEqual({ bookedSeats: 1, heldSeats: 0 });
      jest.mocked(refundsService.refundAmount).mockRestore();
    });
  });

  it('documents the route in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');

    expect(response.status).toBe(200);
    const paths = (
      response.body as { paths: Record<string, Record<string, unknown>> }
    ).paths;
    expect(paths['/api/flight-bookings/{id}/change-flight']).toHaveProperty(
      'patch',
    );
  });
});
