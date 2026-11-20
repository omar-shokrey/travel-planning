import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { CancelledBy } from './../src/flight-bookings/enums/cancelled-by.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE } from './../src/flight-bookings/flight-bookings.constants';
import { FlightCancellationService } from './../src/flight-bookings/flight-cancellation.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { FLIGHT_NOT_BOOKABLE_MESSAGE } from './../src/flights/flight-seat-holds.service';
import {
  FLIGHT_NOT_CANCELLABLE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import {
  StripeGateway,
  type GatewayIntent,
  type GatewayRefund,
} from './../src/payments/stripe.gateway';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE = 25000;

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

interface CancelBody {
  flight: { id: string; status: string };
  cancelledBookings: number;
  expiredHolds: number;
}

const adult = (name: string, passport: string) => ({
  fullName: name,
  dateOfBirth: '1990-01-01',
  passportNumber: passport,
});

/**
 * FLT-06 end to end, on the "-test" database: the fixture's airline cancels a
 * flight that has a one-way booking, a round trip (its return on the other
 * airline) and a hold, all made through the real hold, payment and signed
 * webhook (FLT-23). Only the Stripe calls are replaced. Every record is
 * deleted by id.
 */
describe('Flight cancellation by the airline (e2e, FLT-06)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  let counter = 0;

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const newFlight = (days = 30) =>
    fx.insertFlight({
      departureAt: new Date(Date.now() + days * DAY_MS),
      cabins: [fx.storedCabin({ price: PRICE, totalSeats: 10 })],
    });

  const returnFlight = (days = 37) =>
    fx.insertFlight({
      airlineId: fx.otherAirlineId,
      departureAirport: fx.airports.arrival,
      arrivalAirport: fx.airports.departure,
      departureAt: new Date(Date.now() + days * DAY_MS),
      cabins: [fx.storedCabin({ price: PRICE, totalSeats: 10 })],
    });

  const hold = async (body: Record<string, unknown>) => {
    const response = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send({ cabin: CabinClass.Economy, ...body });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    bookingIds.add(id);
    const accepted = await fx
      .http()
      .post(`/api/bookings/flight/${id}/accept-policies`)
      .set('Cookie', fx.user.cookie)
      .send({ accepted: true });
    expect(accepted.status).toBe(200);
    return id;
  };

  const pay = async (bookingId: string): Promise<PaymentBody> => {
    const started = await fx
      .http()
      .post('/api/payments')
      .set('Cookie', fx.user.cookie)
      .send({ bookingType: 'flight', bookingId });
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
    return payment;
  };

  const cancelFlight = (id: string, actor: Actor | null = fx.moderator) => {
    const call = fx.http().post(`/api/flights/${id}/cancel`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const stored = (id: string) =>
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
    fx = await createFlightFixture('flt06');
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
    jest.spyOn(gateway, 'createRefund').mockImplementation((refund) =>
      Promise.resolve<GatewayRefund>({
        id: `re_${fx.run}_${++counter}`,
        status: 'pending',
        amount: refund.amount,
        currency: 'usd',
        paymentIntentId: refund.paymentIntentId,
      }),
    );
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
    } finally {
      await fx.cleanup();
    }
  });

  describe('a flight with bookings', () => {
    let flightId: string;
    let backId: string;
    let otherFlightId: string;
    const made = {} as Record<
      'oneWay' | 'roundTrip' | 'held' | 'other',
      string
    >;
    let response: Awaited<ReturnType<typeof cancelFlight>>;

    beforeAll(async () => {
      flightId = await newFlight();
      backId = await returnFlight();
      otherFlightId = await newFlight(31);
      made.oneWay = await hold({
        flightId,
        passengers: [
          adult('One Way', 'ONE000001'),
          adult('One Two', 'ONE000002'),
        ],
      });
      await pay(made.oneWay);
      made.roundTrip = await hold({
        flightId,
        returnFlightId: backId,
        returnCabin: CabinClass.Economy,
        passengers: [adult('Round Trip', 'RND000001')],
      });
      await pay(made.roundTrip);
      made.held = await hold({
        flightId,
        passengers: [adult('Still Paying', 'HLD000001')],
      });
      made.other = await hold({
        flightId: otherFlightId,
        passengers: [adult('Other Flight', 'OTH000001')],
      });
      await pay(made.other);
      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 3,
        heldSeats: 1,
      });

      response = await cancelFlight(flightId);
      // Several real bookings on the "-test" database: more than the default 30 s.
    }, 180_000);

    it('cancels the flight and answers the counts', () => {
      expect(response.status).toBe(200);
      expect(response.body as CancelBody).toMatchObject({
        flight: { id: flightId, status: FlightStatus.Cancelled },
        cancelledBookings: 2,
        expiredHolds: 1,
      });
    });

    it('cancels every confirmed booking by the provider with a 100% refund', async () => {
      for (const id of [made.oneWay, made.roundTrip]) {
        const booking = await stored(id);
        expect(booking).toMatchObject({
          status: FlightBookingStatus.Cancelled,
          cancelledBy: CancelledBy.Provider,
          refundPercent: 100,
        });
        expect(booking.cancelledAt).toBeInstanceOf(Date);
        const saved = await refundsOf(id);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
          reason: RefundReason.FlightCancelled,
          refundPercent: 100,
          amount: booking.total,
        });
      }
    });

    it('tells each passenger in the app, with the flight and the reference', async () => {
      for (const id of [made.oneWay, made.roundTrip]) {
        const booking = await stored(id);
        const sent = await notifications
          .find({ userId: fx.user.id, linkId: id })
          .lean()
          .exec();
        const cancelled = sent.filter(
          (n) => n.type === NotificationType.BookingCancelled,
        );
        expect(cancelled).toHaveLength(1);
        expect(cancelled[0].message).toContain(String(booking.reference));
        expect(cancelled[0].message).toContain('refunded in full');
        expect(cancelled[0].message).not.toMatch(/ONE000001|RND000001/);
      }
    });

    it('expires the hold and frees every seat, the return flight’s included', async () => {
      expect((await stored(made.held)).status).toBe(
        FlightBookingStatus.Expired,
      );
      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(await cabinOf(backId)).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });

    it('leaves the bookings of other flights alone', async () => {
      expect((await stored(made.other)).status).toBe(
        FlightBookingStatus.Confirmed,
      );
      expect((await cabinOf(otherFlightId)).bookedSeats).toBe(1);
    });

    it('no longer lets anyone book the flight', async () => {
      const held = await fx
        .http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', fx.user.cookie)
        .send({
          flightId,
          cabin: CabinClass.Economy,
          passengers: [adult('Too Late', 'LATE00001')],
        });
      expect(held.status).toBe(409);
      expect((held.body as { message: string }).message).toBe(
        FLIGHT_NOT_BOOKABLE_MESSAGE,
      );
    });

    it('answers 409 to a second cancellation and refunds nothing more', async () => {
      const again = await cancelFlight(flightId);

      expect(again.status).toBe(409);
      expect((again.body as { message: string }).message).toBe(
        FLIGHT_NOT_CANCELLABLE_MESSAGE,
      );
      expect(await refundsOf(made.oneWay)).toHaveLength(1);
    });
  });

  it('the hourly sweep finishes a cascade that did not run, and the user cannot cancel it for less meanwhile', async () => {
    const flightId = await newFlight();
    const id = await hold({
      flightId,
      passengers: [adult('Sweep Case', 'SWP000001')],
    });
    await pay(id);
    // This suite's own flight is cancelled with no cascade, as after a crash.
    await fx.flights
      .updateOne(
        { _id: flightId },
        { $set: { status: FlightStatus.Cancelled } },
      )
      .exec();

    const preview = await fx
      .http()
      .get(`/api/flight-bookings/${id}/cancel`)
      .set('Cookie', fx.user.cookie);
    expect(preview.status).toBe(409);
    expect((preview.body as { message: string }).message).toBe(
      FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
    );

    const sweeper = fx.app.get(FlightCancellationService);
    for (let run = 0; run < 20; run++) {
      if ((await stored(id)).status !== FlightBookingStatus.Confirmed) break;
      await sweeper.sweep(new Date());
    }

    expect(await stored(id)).toMatchObject({
      status: FlightBookingStatus.Cancelled,
      cancelledBy: CancelledBy.Provider,
      refundPercent: 100,
    });
    expect(await refundsOf(id)).toHaveLength(1);
  }, 90_000);

  it('answers 409 for a flight that has departed, and changes nothing', async () => {
    const flightId = await newFlight();
    await fx.flights
      .updateOne(
        { _id: flightId },
        { $set: { departureAt: new Date(Date.now() - 60_000) } },
      )
      .exec();

    const response = await cancelFlight(flightId);

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      FLIGHT_NOT_CANCELLABLE_MESSAGE,
    );
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    expect(flight.status).toBe(FlightStatus.Scheduled);
  });

  it('answers 403 for another airline’s flight, 404 for a missing one, and changes nothing', async () => {
    const flightId = await newFlight();

    const foreign = await cancelFlight(flightId, fx.otherModerator);
    expect(foreign.status).toBe(403);
    expect((foreign.body as { message: string }).message).toBe(
      FOREIGN_FLIGHT_MESSAGE,
    );
    const missing = await cancelFlight(new Types.ObjectId().toString());
    expect(missing.status).toBe(404);
    expect((missing.body as { message: string }).message).toBe(
      FLIGHT_NOT_FOUND_MESSAGE,
    );
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    expect(flight.status).toBe(FlightStatus.Scheduled);
  });

  it('needs a login (401) and an airline moderator with an airline (403), and a valid id (400)', async () => {
    const flightId = await newFlight();

    expect((await cancelFlight(flightId, null)).status).toBe(401);
    for (const actor of [
      fx.user,
      fx.admin,
      fx.hotelModerator,
      fx.unassignedModerator,
    ]) {
      expect((await cancelFlight(flightId, actor)).status).toBe(403);
    }
    expect((await cancelFlight('not-an-id')).status).toBe(400);
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    expect(flight.status).toBe(FlightStatus.Scheduled);
  });

  it('is documented in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');
    const route = (
      response.body as {
        paths: Record<
          string,
          { post?: { responses: Record<string, unknown> } }
        >;
      }
    ).paths['/api/flights/{id}/cancel'];

    expect(Object.keys(route?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });
});
