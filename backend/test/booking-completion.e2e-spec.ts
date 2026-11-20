import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { FLIGHT_REFERENCE_PATTERN } from './../src/flight-bookings/booking-reference';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FlightBookingCompletionService } from './../src/flight-bookings/flight-booking-completion.service';
import { E_TICKET_NOT_CONFIRMED_MESSAGE } from './../src/flight-bookings/flight-bookings.constants';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingCompletionService } from './../src/hotel-bookings/hotel-booking-completion.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import {
  StripeGateway,
  type GatewayIntent,
} from './../src/payments/stripe.gateway';
import {
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const HOUR_MS = 60 * 60 * 1000;
const PRICE = 25000;

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

/** A UTC date `days` from today as YYYY-MM-DD. */
const utcDay = (days: number): string =>
  DateTime.utc().plus({ days }).toFormat('yyyy-MM-dd');

/**
 * GEN-11 end to end, on the "-test" database: the hourly jobs that move
 * confirmed bookings to `completed`. Flight bookings are confirmed through
 * the real hold, policies, payment and signed webhook (FLT-23), then their
 * flight is moved into the past. Hotel reservations are inserted as stored
 * (the job reads only the booking). The jobs are called directly instead of
 * waiting for the hour. Only the Stripe calls are replaced. Every record is
 * deleted by id.
 */
describe('Booking completion jobs (e2e, GEN-11)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let flightJob: FlightBookingCompletionService;
  let hotelJob: HotelBookingCompletionService;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const hotelBookingIds = new Set<string>();
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
            fullName: 'Complete Test Adult',
            dateOfBirth: '1990-01-01',
            passportNumber: 'COMP12345',
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
  const confirmedBooking = async () => {
    const booking = await heldBooking();
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

  /** Moves this suite's own flight: it left 3 hours ago and landed 1 hour ago. */
  const landed = (flightId: string, fields: Record<string, unknown> = {}) =>
    fx.flights
      .updateOne(
        { _id: flightId },
        {
          $set: {
            departureAt: new Date(Date.now() - 3 * HOUR_MS),
            arrivalAt: new Date(Date.now() - HOUR_MS),
            ...fields,
          },
        },
      )
      .exec();

  const storedBooking = (id: string) =>
    flightBookings.findById(id).lean().orFail().exec();

  /**
   * Runs the flight job until it completes nothing more. A run completes at
   * most one batch, earliest trips first, so bookings that other suites
   * left on the "-test" database cannot hide this suite's own.
   */
  const runFlightJob = async (): Promise<void> => {
    for (let run = 0; run < 20; run++) {
      if ((await flightJob.completeArrived(new Date())) === 0) return;
    }
  };

  /** A reservation stored as the confirmation leaves it (HTL-17). */
  const storedReservation = async (
    status: HotelBookingStatus,
    checkIn: string,
    checkOut: string,
  ): Promise<string> => {
    const created = await hotelBookings.create({
      userId: new Types.ObjectId(fx.user.id),
      hotelId: new Types.ObjectId(),
      checkIn,
      checkOut,
      nights: 2,
      status,
      currency: 'USD',
      total: 2 * PRICE,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: `${fx.run} room`,
          pricePerNight: PRICE,
          adults: 1,
        },
      ],
    });
    const id = created._id.toString();
    hotelBookingIds.add(id);
    return id;
  };

  const reservationStatus = async (id: string) =>
    (await hotelBookings.findById(id).lean().orFail().exec()).status;

  beforeAll(async () => {
    fx = await createFlightFixture('gen11');
    flightBookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    hotelBookings = fx.app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );
    payments = fx.app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = fx.app.get<Model<StripeEvent>>(
      getModelToken(StripeEvent.name),
    );
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    flightJob = fx.app.get(FlightBookingCompletionService);
    hotelJob = fx.app.get(HotelBookingCompletionService);

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
      for (const id of hotelBookingIds) {
        await hotelBookings.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  it('registers both hourly jobs with the scheduler', () => {
    const scheduler = fx.app.get(SchedulerRegistry);

    expect(scheduler.getCronJob('flight-booking-completion')).toBeDefined();
    expect(scheduler.getCronJob('hotel-booking-completion')).toBeDefined();
  });

  describe('flight bookings', () => {
    it('completes a confirmed booking once its flight has arrived, keeping its reference', async () => {
      const booking = await confirmedBooking();
      const before = await storedBooking(booking.id);
      await landed(booking.flightId);

      await runFlightJob();

      const after = await storedBooking(booking.id);
      expect(after.status).toBe(FlightBookingStatus.Completed);
      expect(after.reference).toBe(before.reference);
      expect(after.reference).toMatch(FLIGHT_REFERENCE_PATTERN);
    });

    it('a completed booking no longer has an e-ticket (409)', async () => {
      const booking = await confirmedBooking();
      await landed(booking.flightId);
      await runFlightJob();

      const response = await fx
        .http()
        .get(`/api/flight-bookings/${booking.id}/e-ticket`)
        .set('Cookie', fx.user.cookie);

      expect(response.status).toBe(409);
      expect((response.body as { message: string }).message).toBe(
        E_TICKET_NOT_CONFIRMED_MESSAGE,
      );
    });

    it('keeps a booking confirmed while its flight has not arrived', async () => {
      const booking = await confirmedBooking();

      await runFlightJob();

      expect((await storedBooking(booking.id)).status).toBe(
        FlightBookingStatus.Confirmed,
      );
    });

    it('keeps a booking confirmed when its flight was cancelled, even after the arrival time', async () => {
      const booking = await confirmedBooking();
      await landed(booking.flightId, { status: FlightStatus.Cancelled });

      await runFlightJob();

      expect((await storedBooking(booking.id)).status).toBe(
        FlightBookingStatus.Confirmed,
      );
    });

    it('never completes a booking that is waiting for payment', async () => {
      const booking = await heldBooking();
      await landed(booking.flightId);

      await runFlightJob();

      expect((await storedBooking(booking.id)).status).toBe(
        FlightBookingStatus.PendingPayment,
      );
    });

    it('a second run changes nothing', async () => {
      const booking = await confirmedBooking();
      await landed(booking.flightId);
      await runFlightJob();
      const first = await storedBooking(booking.id);

      await runFlightJob();

      const second = await storedBooking(booking.id);
      expect(second.status).toBe(FlightBookingStatus.Completed);
      expect(second.updatedAt).toEqual(first.updatedAt);
    });
  });

  describe('hotel reservations', () => {
    it('completes a confirmed reservation whose check-out day has passed (UTC)', async () => {
      const id = await storedReservation(
        HotelBookingStatus.Confirmed,
        utcDay(-3),
        utcDay(-1),
      );

      await hotelJob.completeCheckedOut(new Date());

      expect(await reservationStatus(id)).toBe(HotelBookingStatus.Completed);
    });

    it('keeps a reservation confirmed on its check-out day and before it', async () => {
      const today = await storedReservation(
        HotelBookingStatus.Confirmed,
        utcDay(-2),
        utcDay(0),
      );
      const future = await storedReservation(
        HotelBookingStatus.Confirmed,
        utcDay(5),
        utcDay(7),
      );

      await hotelJob.completeCheckedOut(new Date());

      expect(await reservationStatus(today)).toBe(HotelBookingStatus.Confirmed);
      expect(await reservationStatus(future)).toBe(
        HotelBookingStatus.Confirmed,
      );
    });

    it('never completes a reservation that is not confirmed', async () => {
      const ids = await Promise.all(
        [
          HotelBookingStatus.PendingPayment,
          HotelBookingStatus.Expired,
          HotelBookingStatus.Cancelled,
        ].map((status) => storedReservation(status, utcDay(-3), utcDay(-1))),
      );

      await hotelJob.completeCheckedOut(new Date());

      expect(await Promise.all(ids.map(reservationStatus))).toEqual([
        HotelBookingStatus.PendingPayment,
        HotelBookingStatus.Expired,
        HotelBookingStatus.Cancelled,
      ]);
    });
  });
});
