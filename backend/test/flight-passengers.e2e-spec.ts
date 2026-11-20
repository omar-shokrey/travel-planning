import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import {
  StripeGateway,
  type GatewayIntent,
} from './../src/payments/stripe.gateway';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const PRICE = 25000;

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

interface Passenger {
  fullName: string;
  dateOfBirth: string;
  passportNumber: string;
}

interface BookingsBody {
  flight: {
    id: string;
    cabins: { cabin: string; totalSeats: number; availableSeats: number }[];
  };
  bookings: {
    bookingId: string;
    reference: string;
    status: string;
    cabin: string;
    seats: number;
    passengers: { fullName: string; type: string }[];
    cancelledAt: string | null;
  }[];
  passengerCount: number;
}

/** A date of birth `years` years before today, as YYYY-MM-DD. */
const bornYearsAgo = (years: number): string =>
  DateTime.utc().minus({ years, days: 1 }).toFormat('yyyy-MM-dd');

/**
 * FLT-29 end to end, on the "-test" database: one flight of the fixture's
 * airline gets two confirmed bookings, a cancelled one and a hold, through
 * the real hold, payment and signed webhook (FLT-23) and cancellation
 * (FLT-26). Its moderator reads the bookings and exports the passenger list.
 * Only the Stripe calls are replaced. Every record is deleted by id.
 */
describe('Bookings and passenger list of a flight (e2e, FLT-29)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  let counter = 0;
  let flightId: string;
  const made = {} as Record<
    'family' | 'business' | 'cancelled' | 'held',
    string
  >;

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const hold = async (cabin: CabinClass, passengers: Passenger[]) => {
    const response = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send({ flightId, cabin, passengers });
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

  const pay = async (bookingId: string) => {
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
  };

  const bookingsOf = (id: string, actor: Actor | null = fx.moderator) => {
    const call = fx.http().get(`/api/flights/${id}/bookings`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const exportOf = (id: string, actor: Actor | null = fx.moderator) => {
    const call = fx.http().get(`/api/flights/${id}/passengers/export`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt29');
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

    flightId = await fx.insertFlight({
      cabins: [
        fx.storedCabin({
          cabin: CabinClass.Economy,
          price: PRICE,
          totalSeats: 10,
        }),
        fx.storedCabin({
          cabin: CabinClass.Business,
          price: PRICE,
          totalSeats: 4,
        }),
      ],
    });
    made.family = await hold(CabinClass.Economy, [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'FAM000001',
      },
      {
        fullName: 'Baby Ahmed',
        dateOfBirth: bornYearsAgo(1),
        passportNumber: 'FAM000002',
      },
    ]);
    await pay(made.family);
    made.business = await hold(CabinClass.Business, [
      {
        fullName: 'Ahmed, Omar',
        dateOfBirth: '1985-01-30',
        passportNumber: 'BUS000001',
      },
      {
        fullName: '=SUM(1+1)',
        dateOfBirth: '1987-03-02',
        passportNumber: 'BUS000002',
      },
    ]);
    await pay(made.business);
    made.cancelled = await hold(CabinClass.Economy, [
      {
        fullName: 'Gone Traveller',
        dateOfBirth: '1970-07-07',
        passportNumber: 'CAN000001',
      },
    ]);
    await pay(made.cancelled);
    const cancelled = await fx
      .http()
      .post(`/api/flight-bookings/${made.cancelled}/cancel`)
      .set('Cookie', fx.user.cookie)
      .send({ expectedRefundPercent: 0 });
    expect(cancelled.status).toBe(200);
    made.held = await hold(CabinClass.Economy, [
      {
        fullName: 'Still Paying',
        dateOfBirth: '1980-08-08',
        passportNumber: 'HLD000001',
      },
    ]);
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
    } finally {
      await fx.cleanup();
    }
  });

  it('shows the paid bookings by reference, with their cabin, seats, passengers and status', async () => {
    const response = await bookingsOf(flightId);

    expect(response.status).toBe(200);
    const body = response.body as BookingsBody;
    const references = body.bookings.map((b) => b.reference);
    expect(references).toEqual([...references].sort());
    const byId = new Map(body.bookings.map((b) => [b.bookingId, b]));
    expect([...byId.keys()].sort()).toEqual(
      [made.family, made.business, made.cancelled].sort(),
    );
    expect(byId.get(made.family)).toMatchObject({
      status: FlightBookingStatus.Confirmed,
      cabin: CabinClass.Economy,
      seats: 1,
      passengers: [
        { fullName: 'Sara Ahmed', type: 'adult' },
        { fullName: 'Baby Ahmed', type: 'infant' },
      ],
      cancelledAt: null,
    });
    expect(byId.get(made.business)).toMatchObject({
      status: FlightBookingStatus.Confirmed,
      cabin: CabinClass.Business,
      seats: 2,
    });
    expect(byId.get(made.cancelled)?.status).toBe(
      FlightBookingStatus.Cancelled,
    );
    expect(byId.get(made.cancelled)?.cancelledAt).toMatch(/Z$/);
    expect(body.passengerCount).toBe(4);
    expect(JSON.stringify(body)).not.toMatch(/FAM000001|BUS000001|1990-05-14/);
  });

  it('shows the seats remaining per cabin, held seats counted out', async () => {
    const response = await bookingsOf(flightId);
    const cabins = (response.body as BookingsBody).flight.cabins;

    // Economy: 10 - 1 booked - 1 held (the cancelled booking gave its seat back).
    expect(
      cabins.find((c) => c.cabin === CabinClass.Economy)?.availableSeats,
    ).toBe(8);
    expect(
      cabins.find((c) => c.cabin === CabinClass.Business)?.availableSeats,
    ).toBe(2);
  });

  it('exports the passengers who fly as CSV', async () => {
    const response = await exportOf(flightId).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="passengers-[A-Z0-9]+-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const text = response.text;
    // The file starts with a UTF-8 byte order mark, then the header.
    expect(
      text
        .replace(/^\uFEFF/, '')
        .startsWith('Reference,Passenger,Type,Cabin,Booking status\r\n'),
    ).toBe(true);
    const rows = text.trim().split('\r\n').slice(1);
    expect(rows).toHaveLength(4);
    expect(
      rows.some((row) => row.includes('Sara Ahmed,adult,economy,confirmed')),
    ).toBe(true);
    expect(
      rows.some((row) => row.includes('Baby Ahmed,infant,economy,confirmed')),
    ).toBe(true);
    expect(
      rows.some((row) =>
        row.includes('"Ahmed, Omar",adult,business,confirmed'),
      ),
    ).toBe(true);
    // A spreadsheet never runs a passenger name as a formula.
    expect(
      rows.some((row) => row.includes(",'=SUM(1+1),adult,business,")),
    ).toBe(true);
    expect(text).not.toMatch(/Gone Traveller|Still Paying|FAM000001/);
  });

  it('answers 403 for another airline’s moderator and 404 for a missing flight', async () => {
    for (const response of [
      await bookingsOf(flightId, fx.otherModerator),
      await exportOf(flightId, fx.otherModerator),
    ]) {
      expect(response.status).toBe(403);
      expect((response.body as { message: string }).message).toBe(
        FOREIGN_FLIGHT_MESSAGE,
      );
    }
    const missing = new Types.ObjectId().toString();
    for (const response of [
      await bookingsOf(missing),
      await exportOf(missing),
    ]) {
      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe(
        FLIGHT_NOT_FOUND_MESSAGE,
      );
    }
  });

  it('needs a login (401) and an airline moderator with an airline (403)', async () => {
    expect((await bookingsOf(flightId, null)).status).toBe(401);
    expect((await exportOf(flightId, null)).status).toBe(401);
    for (const actor of [
      fx.user,
      fx.admin,
      fx.hotelModerator,
      fx.unassignedModerator,
    ]) {
      expect((await bookingsOf(flightId, actor)).status).toBe(403);
      expect((await exportOf(flightId, actor)).status).toBe(403);
    }
  });

  it('answers 400 for a bad id', async () => {
    expect((await bookingsOf('not-an-id')).status).toBe(400);
    expect((await exportOf('not-an-id')).status).toBe(400);
  });

  it('is documented in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json');
    const paths = (
      response.body as {
        paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
      }
    ).paths;

    for (const path of [
      '/api/flights/{id}/bookings',
      '/api/flights/{id}/passengers/export',
    ]) {
      expect(Object.keys(paths[path]?.get?.responses ?? {})).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404']),
      );
    }
  });
});
