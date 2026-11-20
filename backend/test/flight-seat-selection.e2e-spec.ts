import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { PLATFORM_CURRENCY } from './../src/common/constants/currency';
import { Role } from './../src/common/enums/role.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from './../src/flight-bookings/enums/passenger-type.enum';
import { SeatStatus } from './../src/flight-bookings/enums/seat-status.enum';
import { FlightBookingExpiryService } from './../src/flight-bookings/flight-booking-expiry.service';
import {
  INFANT_SEAT_MESSAGE,
  SEATS_DEPARTED_MESSAGE,
  SEATS_FLIGHT_CANCELLED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEAT_TAKEN_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
} from './../src/flight-bookings/flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/flight-bookings/flight-bookings.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { FlightSeatAssignment } from './../src/flight-bookings/models/flight-seat-assignment.schema';
import { buildSeatMap, firstRowOf } from './../src/flight-bookings/seat-map';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
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
/** Every test that sends many requests gets more than Jest's 5 seconds. */
const SLOW = 120_000;
/** 12 economy seats: rows 1 and 2, A to F. */
const ECONOMY_SEATS = 12;

interface PassengerIn {
  fullName: string;
  dateOfBirth: string;
  passportNumber: string;
}
interface SegmentSeats {
  segmentIndex: number;
  flightId: string;
  cabin: CabinClass;
  passengers: { passengerIndex: number; seatNumber: string | null }[];
}
interface SeatMapBody {
  bookingId: string;
  segments: {
    segmentIndex: number;
    flightId: string;
    cabin: CabinClass;
    seats: { seatNumber: string; status: SeatStatus }[];
  }[];
  passengers: {
    passengerIndex: number;
    fullName: string;
    type: PassengerType;
    needsSeat: boolean;
    seats: (string | null)[];
  }[];
}

const adult = (label: string): PassengerIn => ({
  fullName: `Seat Test ${label}`,
  dateOfBirth: '1990-01-01',
  passportNumber: `SEAT${label.toUpperCase().replace(/[^A-Z0-9]/g, '')}1`,
});
const child: PassengerIn = {
  fullName: 'Seat Test Child',
  dateOfBirth: DateTime.utc().minus({ years: 8 }).toISODate() as string,
  passportNumber: 'SEATCHILD1',
};
const infant: PassengerIn = {
  fullName: 'Seat Test Infant',
  dateOfBirth: DateTime.utc().minus({ months: 6 }).toISODate() as string,
  passportNumber: 'SEATINFANT1',
};

/**
 * FLT-28 end to end, on the "-test" database. The main bookings are
 * confirmed through the real hold, policies, payment and signed webhook
 * (FLT-23), so the seat counters are real; bookings in other statuses are
 * inserted straight in the database. Only Stripe is replaced, the app's
 * scheduled jobs are stopped, and every record is deleted by id.
 */
describe('Seat selection (e2e, FLT-28)', () => {
  let fx: FlightFixture;
  let flightBookings: Model<FlightBooking>;
  let assignments: Model<FlightSeatAssignment>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let other: Actor;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  const userIds: string[] = [];
  let counter = 0;

  /** The flights most tests use. */
  let mainFlight = '';
  let returnFlight = '';
  /** The owner's booking: an adult, a child and an infant on mainFlight. */
  let family = '';
  /** Another user's booking on mainFlight. */
  let othersBooking = '';
  /** The owner's round trip: mainFlight then returnFlight. */
  let roundTrip = '';

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const send = (
    verb: 'get' | 'patch',
    path: string,
    actor: Actor | null,
    body?: unknown,
  ) => {
    let call = fx.http()[verb](path);
    if (actor) call = call.set('Cookie', actor.cookie);
    return body === undefined ? call : call.send(body as object);
  };
  const choose = (id: string, body: unknown, actor: Actor | null = fx.user) =>
    send('patch', `/api/flight-bookings/${id}/seat`, actor, body);
  const seatMapOf = (id: string, actor: Actor | null = fx.user) =>
    send('get', `/api/flight-bookings/${id}/seat-map`, actor);
  const seatsOf = (id: string) =>
    assignments
      .find({ bookingId: new Types.ObjectId(id) })
      .sort({ segmentIndex: 1, passengerIndex: 1 })
      .lean()
      .exec();
  const cabinOf = async (flightId: string, cabin = CabinClass.Economy) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    const found = flight.cabins.find((one) => one.cabin === cabin);
    return {
      totalSeats: found?.totalSeats,
      bookedSeats: found?.bookedSeats,
      heldSeats: found?.heldSeats,
    };
  };
  const economyFlight = (
    fields: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) =>
    fx.insertFlight({
      cabins: [fx.storedCabin({ totalSeats: ECONOMY_SEATS, price: 20000 })],
      ...fields,
    });

  /** A booking confirmed through the real hold, policies, payment and webhook. */
  const confirmedBooking = async (
    actor: Actor,
    flightId: string,
    passengers: PassengerIn[],
    returnFlightId?: string,
  ): Promise<string> => {
    const hold = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', actor.cookie)
      .send({
        flightId,
        cabin: CabinClass.Economy,
        passengers,
        ...(returnFlightId && {
          returnFlightId,
          returnCabin: CabinClass.Economy,
        }),
      });
    expect(hold.status).toBe(201);
    const id = (hold.body as { id: string }).id;
    bookingIds.add(id);
    const accepted = await fx
      .http()
      .post(`/api/bookings/flight/${id}/accept-policies`)
      .set('Cookie', actor.cookie)
      .send({ accepted: true });
    expect(accepted.status).toBe(200);
    const started = await fx
      .http()
      .post('/api/payments')
      .set('Cookie', actor.cookie)
      .send({ bookingType: 'flight', bookingId: id });
    expect(started.status).toBe(201);
    const payment = started.body as {
      id: string;
      stripePaymentIntentId: string;
      amount: number;
    };
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
    const stored = await flightBookings.findById(id).lean().orFail().exec();
    expect(stored.status).toBe(FlightBookingStatus.Confirmed);
    return id;
  };

  /** A booking in any status, straight in the database: it touches no seat counter. */
  const storedBooking = async (
    status: FlightBookingStatus,
    flightId: string,
    fields: Record<string, unknown> = {},
  ): Promise<string> => {
    const _id = new Types.ObjectId();
    bookingIds.add(_id.toString());
    await flightBookings.collection.insertOne({
      _id,
      userId: new Types.ObjectId(fx.user.id),
      status,
      currency: PLATFORM_CURRENCY,
      fareTotal: 20000,
      baggageTotal: 0,
      total: 20000,
      segments: [
        {
          flightId: new Types.ObjectId(flightId),
          airlineId: new Types.ObjectId(fx.airlineId),
          cabin: CabinClass.Economy,
          fare: 20000,
          seatsReserved: 1,
          cancellationTiers: [],
          maxExtraBags: 0,
        },
      ],
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      passengers: [
        {
          ...adult('Stored'),
          type: PassengerType.Adult,
          baggage: [],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields,
    });
    return _id.toString();
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt28');
    const model = <T>(name: string) =>
      fx.app.get<Model<T>>(getModelToken(name));
    flightBookings = model<FlightBooking>(FlightBooking.name);
    assignments = model<FlightSeatAssignment>(FlightSeatAssignment.name);
    payments = model<Payment>(Payment.name);
    stripeEvents = model<StripeEvent>(StripeEvent.name);
    refunds = model<Refund>(Refund.name);
    notifications = model<Notification>(Notification.name);
    users = model<User>(User.name);
    // The unique indexes decide the races below: make sure they exist.
    await assignments.init();

    // The app's jobs would act on other suites' records: stop them. The
    // expiry test below runs the job itself.
    for (const job of fx.app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }

    // Nothing reaches Stripe: only the webhook signature check is real.
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

    const created = await users.create({
      name: `${fx.run} other user`,
      email: `${fx.run}-other-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      consentAcceptedAt: new Date(),
    });
    userIds.push(created._id.toString());
    other = {
      id: created._id.toString(),
      cookie: await sessionCookieFor(fx.app, created._id.toString()),
    };

    const departureAt = new Date(Date.now() + 30 * DAY_MS);
    mainFlight = await economyFlight({ departureAt });
    returnFlight = await economyFlight({
      departureAt: new Date(departureAt.getTime() + 2 * DAY_MS),
      departureAirport: fx.airports.arrival,
      arrivalAirport: fx.airports.departure,
    });
    family = await confirmedBooking(fx.user, mainFlight, [
      adult('Mother'),
      child,
      infant,
    ]);
    othersBooking = await confirmedBooking(other, mainFlight, [adult('Other')]);
    roundTrip = await confirmedBooking(
      fx.user,
      mainFlight,
      [adult('Round')],
      returnFlight,
    );
  }, SLOW);

  afterAll(async () => {
    if (!fx) return;
    jest.restoreAllMocks();
    try {
      for (const id of bookingIds) {
        for (const { _id } of await seatsOf(id)) {
          await assignments.findByIdAndDelete(_id).exec();
        }
        for (const { _id } of await notifications
          .find({ linkId: id })
          .select('_id')
          .lean()
          .exec()) {
          await notifications.findByIdAndDelete(_id).exec();
        }
        for (const { _id } of await refunds
          .find({ bookingId: new Types.ObjectId(id) })
          .select('_id')
          .lean()
          .exec()) {
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

  describe('choosing seats', () => {
    it('gives one passenger a seat and answers the booking details with it', async () => {
      const response = await choose(
        othersBooking,
        {
          seats: [{ passengerIndex: 0, seatNumber: '2F' }],
        },
        other,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(othersBooking);
      expect(response.body.seats as SegmentSeats[]).toEqual([
        {
          segmentIndex: 0,
          flightId: mainFlight,
          cabin: CabinClass.Economy,
          passengers: [{ passengerIndex: 0, seatNumber: '2F' }],
        },
      ]);
      expect(await seatsOf(othersBooking)).toHaveLength(1);
    });

    it('gives several passengers their seats in one request, and GET :id, the list and the seat map show them', async () => {
      const before = await cabinOf(mainFlight);

      const response = await choose(family, {
        seats: [
          { passengerIndex: 0, seatNumber: '1A' },
          { passengerIndex: 1, seatNumber: '1B' },
        ],
      });

      expect(response.status).toBe(200);
      const expected = [
        {
          segmentIndex: 0,
          flightId: mainFlight,
          cabin: CabinClass.Economy,
          passengers: [
            { passengerIndex: 0, seatNumber: '1A' },
            { passengerIndex: 1, seatNumber: '1B' },
          ],
        },
      ];
      expect(response.body.seats).toEqual(expected);

      const details = await send(
        'get',
        `/api/flight-bookings/${family}`,
        fx.user,
      );
      expect(details.status).toBe(200);
      expect(details.body.seats).toEqual(expected);

      const list = await send(
        'get',
        '/api/flight-bookings?group=upcoming&limit=50',
        fx.user,
      );
      const item = (
        list.body.items as { id: string; seats: SegmentSeats[] }[]
      ).find((one) => one.id === family);
      expect(item?.seats).toEqual(expected);

      const map = (await seatMapOf(family)).body as SeatMapBody;
      const status = (seat: string) =>
        map.segments[0].seats.find((one) => one.seatNumber === seat)?.status;
      expect(status('1A')).toBe(SeatStatus.Yours);
      expect(status('1B')).toBe(SeatStatus.Yours);
      expect(status('2F')).toBe(SeatStatus.Taken);
      expect(status('1C')).toBe(SeatStatus.Available);

      // FLT-22: choosing seats never changes the seat counters.
      expect(await cabinOf(mainFlight)).toEqual(before);
    });

    it('lists every seat of the cabin on the seat map, the passengers and the infant without a seat, and never who holds a taken seat', async () => {
      const response = await seatMapOf(family);
      const map = response.body as SeatMapBody;

      expect(response.status).toBe(200);
      expect(map.bookingId).toBe(family);
      expect(map.segments[0].seats.map((seat) => seat.seatNumber)).toEqual(
        buildSeatMap(CabinClass.Economy, ECONOMY_SEATS),
      );
      expect(map.passengers).toEqual([
        expect.objectContaining({
          passengerIndex: 0,
          needsSeat: true,
          seats: ['1A'],
        }),
        expect.objectContaining({
          passengerIndex: 1,
          needsSeat: true,
          seats: ['1B'],
        }),
        expect.objectContaining({
          passengerIndex: 2,
          type: PassengerType.Infant,
          needsSeat: false,
          seats: [null],
        }),
      ]);
      expect(JSON.stringify(map)).not.toContain(othersBooking);
      expect(JSON.stringify(map)).not.toContain(other.id);
    });

    it('gives the e-ticket of a booking with seats', async () => {
      const response = await send(
        'get',
        `/api/flight-bookings/${family}/e-ticket`,
        fx.user,
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
    });

    it('moves a passenger to another seat and frees the old one', async () => {
      const response = await choose(family, {
        seats: [{ passengerIndex: 1, seatNumber: '1C' }],
      });

      expect(response.status).toBe(200);
      expect(response.body.seats[0].passengers).toEqual([
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1C' },
      ]);
      const map = (await seatMapOf(othersBooking, other)).body as SeatMapBody;
      const status = (seat: string) =>
        map.segments[0].seats.find((one) => one.seatNumber === seat)?.status;
      expect(status('1B')).toBe(SeatStatus.Available);
      expect(status('1C')).toBe(SeatStatus.Taken);
    });

    it('answers 200 and changes nothing for the same seat again', async () => {
      const before = await seatsOf(family);

      const response = await choose(family, {
        seats: [{ passengerIndex: 0, seatNumber: '1A' }],
      });

      expect(response.status).toBe(200);
      const after = await seatsOf(family);
      expect(after).toEqual(before);
    });

    it('lets each segment of a round trip have its own seats, and needs segmentIndex', async () => {
      const missing = await choose(roundTrip, {
        seats: [{ passengerIndex: 0, seatNumber: '2A' }],
      });
      expect(missing.status).toBe(400);
      expect(missing.body.errors).toEqual([
        { field: 'segmentIndex', messages: [SEGMENT_INDEX_REQUIRED_MESSAGE] },
      ]);

      const outbound = await choose(roundTrip, {
        segmentIndex: 0,
        seats: [{ passengerIndex: 0, seatNumber: '2A' }],
      });
      // The same label on the return flight is a different seat.
      const back = await choose(roundTrip, {
        segmentIndex: 1,
        seats: [{ passengerIndex: 0, seatNumber: '2A' }],
      });

      expect(outbound.status).toBe(200);
      expect(back.status).toBe(200);
      expect(
        (back.body.seats as SegmentSeats[]).map((segment) => [
          segment.flightId,
          segment.passengers[0].seatNumber,
        ]),
      ).toEqual([
        [mainFlight, '2A'],
        [returnFlight, '2A'],
      ]);
      expect(await seatsOf(roundTrip)).toHaveLength(2);
    });
  });

  describe('races and all or nothing', () => {
    it('gives a seat two users ask for at the same time to exactly one of them', async () => {
      const [mine, theirs] = await Promise.all([
        choose(family, { seats: [{ passengerIndex: 0, seatNumber: '2B' }] }),
        choose(
          othersBooking,
          { seats: [{ passengerIndex: 0, seatNumber: '2B' }] },
          other,
        ),
      ]);

      expect([mine.status, theirs.status].sort()).toEqual([200, 409]);
      const loser = mine.status === 409 ? mine : theirs;
      expect(loser.body.message).toBe(SEAT_TAKEN_MESSAGE);
      expect(
        await assignments
          .countDocuments({
            flightId: new Types.ObjectId(mainFlight),
            seatNumber: '2B',
          })
          .exec(),
      ).toBe(1);
    });

    it(
      'ends with one seat for a passenger asked twice at the same time for different seats',
      async () => {
        // A passenger with no seat yet: both requests try to create the seat.
        const fresh = await confirmedBooking(fx.user, mainFlight, [
          adult('Twice'),
        ]);

        const results = await Promise.all([
          choose(fresh, { seats: [{ passengerIndex: 0, seatNumber: '2C' }] }),
          choose(fresh, { seats: [{ passengerIndex: 0, seatNumber: '2D' }] }),
        ]);

        expect(results.map((result) => result.status)).toEqual([200, 200]);
        const held = await seatsOf(fresh);
        expect(held).toHaveLength(1);
        expect(['2C', '2D']).toContain(held[0].seatNumber);
        // The other seat is free again.
        const map = (await seatMapOf(fresh)).body as SeatMapBody;
        const free = held[0].seatNumber === '2C' ? '2D' : '2C';
        expect(
          map.segments[0].seats.find((seat) => seat.seatNumber === free)
            ?.status,
        ).toBe(SeatStatus.Available);
      },
      SLOW,
    );

    it('moves nobody when one seat of a request is taken: the first passenger keeps the seat they had', async () => {
      const takenSeat = (await seatsOf(othersBooking))[0].seatNumber;
      const before = await seatsOf(family);

      const response = await choose(family, {
        seats: [
          { passengerIndex: 0, seatNumber: '2E' },
          { passengerIndex: 1, seatNumber: takenSeat },
        ],
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(SEAT_TAKEN_MESSAGE);
      expect(await seatsOf(family)).toEqual(before);
      const after = await seatsOf(family);
      expect(
        after.map((seat) => [seat.passengerIndex, seat.seatNumber]),
      ).not.toContainEqual([0, '2E']);
      expect(after.find((seat) => seat.passengerIndex === 1)?.seatNumber).toBe(
        '1C',
      );
    });

    it('answers 409 for a swap of two passengers in one request, and moves nobody', async () => {
      const before = await seatsOf(family);
      const [first, second] = before;

      const response = await choose(family, {
        seats: [
          {
            passengerIndex: first.passengerIndex,
            seatNumber: second.seatNumber,
          },
          {
            passengerIndex: second.passengerIndex,
            seatNumber: first.seatNumber,
          },
        ],
      });

      expect(response.status).toBe(409);
      expect(await seatsOf(family)).toEqual(before);
    });
  });

  describe('invalid requests (400)', () => {
    it.each([
      [
        'a seat that is not on the seat map',
        { seats: [{ passengerIndex: 0, seatNumber: '3A' }] },
        'seats.0.seatNumber',
        'Seat 3A is not on the seat map of the Economy cabin',
      ],
      [
        'a seat of another cabin',
        {
          seats: [
            {
              passengerIndex: 0,
              seatNumber: `${firstRowOf(CabinClass.Business)}A`,
            },
          ],
        },
        'seats.0.seatNumber',
        `Seat ${firstRowOf(CabinClass.Business)}A is not on the seat map of the Economy cabin`,
      ],
      [
        'an infant',
        { seats: [{ passengerIndex: 2, seatNumber: '2C' }] },
        'seats.0.passengerIndex',
        INFANT_SEAT_MESSAGE,
      ],
      [
        'a passenger the booking does not have',
        { seats: [{ passengerIndex: 5, seatNumber: '2C' }] },
        'seats.0.passengerIndex',
        'passengerIndex must be between 0 and 2: the position of the passenger in the booking',
      ],
      [
        'a segment a one-way booking does not have',
        { segmentIndex: 1, seats: [{ passengerIndex: 0, seatNumber: '2C' }] },
        'segmentIndex',
        'segmentIndex must be 0: this booking has one flight',
      ],
      [
        'a seat named twice',
        {
          seats: [
            { passengerIndex: 0, seatNumber: '2C' },
            { passengerIndex: 1, seatNumber: '2C' },
          ],
        },
        'seats',
        'seats must name each seat at most once',
      ],
      [
        'a passenger named twice',
        {
          seats: [
            { passengerIndex: 0, seatNumber: '2C' },
            { passengerIndex: 0, seatNumber: '2D' },
          ],
        },
        'seats',
        'seats must name each passenger at most once',
      ],
      ['no seat', { seats: [] }, 'seats', 'seats must have at least 1 seat'],
      [
        'a cabin',
        {
          cabin: CabinClass.Business,
          seats: [{ passengerIndex: 0, seatNumber: '2C' }],
        },
        'cabin',
        'property cabin should not exist',
      ],
      [
        'a user id',
        {
          userId: '6740f1c2a4b5c6d7e8f90bbb',
          seats: [{ passengerIndex: 0, seatNumber: '2C' }],
        },
        'userId',
        'property userId should not exist',
      ],
      [
        'a booking id',
        {
          bookingId: '6740f1c2a4b5c6d7e8f90bbb',
          seats: [{ passengerIndex: 0, seatNumber: '2C' }],
        },
        'bookingId',
        'property bookingId should not exist',
      ],
    ])(
      'refuses %s, and changes nothing',
      async (_label, body, field, message) => {
        const before = await seatsOf(family);

        const response = await choose(family, body);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation failed');
        expect(
          (
            response.body.errors as { field: string; messages: string[] }[]
          ).find((error) => error.field === field)?.messages,
        ).toContain(message);
        expect(await seatsOf(family)).toEqual(before);
      },
    );

    it('refuses an id that is not an id', async () => {
      const response = await choose('not-an-id', {
        seats: [{ passengerIndex: 0, seatNumber: '2C' }],
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'id must be a valid id (24 hexadecimal characters)',
      );
    });
  });

  describe('when seats cannot be chosen (409)', () => {
    it.each([
      FlightBookingStatus.PendingPayment,
      FlightBookingStatus.Cancelled,
      FlightBookingStatus.Expired,
      FlightBookingStatus.Completed,
    ])('refuses a %s booking', async (status) => {
      const id = await storedBooking(status, mainFlight, {
        ...(status === FlightBookingStatus.PendingPayment && {
          holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      });

      const response = await choose(id, {
        seats: [{ passengerIndex: 0, seatNumber: '2C' }],
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(SEATS_NOT_CONFIRMED_MESSAGE);
      expect(await seatsOf(id)).toEqual([]);
    });

    it.each([
      [
        'a departed flight',
        {
          status: FlightStatus.Departed,
          departureAt: new Date(Date.now() - DAY_MS),
        },
        SEATS_DEPARTED_MESSAGE,
      ],
      [
        'a flight whose departure time has passed',
        { departureAt: new Date(Date.now() - 60_000) },
        SEATS_DEPARTED_MESSAGE,
      ],
      [
        'a flight the airline cancelled',
        { status: FlightStatus.Cancelled },
        SEATS_FLIGHT_CANCELLED_MESSAGE,
      ],
    ])('refuses %s', async (_label, flightFields, message) => {
      const flightId = await economyFlight(flightFields);
      const id = await storedBooking(FlightBookingStatus.Confirmed, flightId);

      const response = await choose(id, {
        seats: [{ passengerIndex: 0, seatNumber: '1A' }],
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(message);
      expect(await seatsOf(id)).toEqual([]);
    });
  });

  describe('seats are freed when the booking stops needing them', () => {
    it(
      'frees the seats of a booking the user cancels (FLT-26), and someone else can then take them',
      async () => {
        const flightId = await economyFlight();
        const mine = await confirmedBooking(fx.user, flightId, [
          adult('Leaving'),
        ]);
        const theirs = await confirmedBooking(other, flightId, [
          adult('Staying'),
        ]);
        expect(
          (
            await choose(mine, {
              seats: [{ passengerIndex: 0, seatNumber: '1A' }],
            })
          ).status,
        ).toBe(200);

        const preview = await send(
          'get',
          `/api/flight-bookings/${mine}/cancel`,
          fx.user,
        );
        const cancelled = await fx
          .http()
          .post(`/api/flight-bookings/${mine}/cancel`)
          .set('Cookie', fx.user.cookie)
          .send({ expectedRefundPercent: preview.body.refundPercent });

        expect(cancelled.status).toBe(200);
        expect(await seatsOf(mine)).toEqual([]);
        const taken = await choose(
          theirs,
          { seats: [{ passengerIndex: 0, seatNumber: '1A' }] },
          other,
        );
        expect(taken.status).toBe(200);
        expect(taken.body.seats[0].passengers[0].seatNumber).toBe('1A');
      },
      SLOW,
    );

    it(
      'frees the seats of a booking the airline cancels with its flight (FLT-06)',
      async () => {
        const flightId = await economyFlight();
        const booking = await confirmedBooking(fx.user, flightId, [
          adult('Grounded'),
        ]);
        expect(
          (
            await choose(booking, {
              seats: [{ passengerIndex: 0, seatNumber: '2B' }],
            })
          ).status,
        ).toBe(200);

        const response = await fx
          .http()
          .post(`/api/flights/${flightId}/cancel`)
          .set('Cookie', fx.moderator.cookie);

        expect(response.status).toBe(200);
        const stored = await flightBookings
          .findById(booking)
          .lean()
          .orFail()
          .exec();
        expect(stored.status).toBe(FlightBookingStatus.Cancelled);
        expect(await seatsOf(booking)).toEqual([]);
      },
      SLOW,
    );

    it('frees any seat of a booking whose hold expires', async () => {
      const flightId = await fx.insertFlight({
        cabins: [fx.storedCabin({ totalSeats: ECONOMY_SEATS, heldSeats: 1 })],
      });
      const pending = await storedBooking(
        FlightBookingStatus.PendingPayment,
        flightId,
        {
          holdExpiresAt: new Date(Date.now() - 60_000),
        },
      );
      // A booking waiting for payment cannot choose a seat through the route;
      // this one is written straight in the database to check the release.
      await assignments.create({
        flightId: new Types.ObjectId(flightId),
        cabin: CabinClass.Economy,
        seatNumber: '1A',
        bookingId: new Types.ObjectId(pending),
        userId: new Types.ObjectId(fx.user.id),
        segmentIndex: 0,
        passengerIndex: 0,
      });

      await fx.app.get(FlightBookingExpiryService).expireDueHolds(new Date());

      const stored = await flightBookings
        .findById(pending)
        .lean()
        .orFail()
        .exec();
      expect(stored.status).toBe(FlightBookingStatus.Expired);
      expect(await seatsOf(pending)).toEqual([]);
      expect((await cabinOf(flightId)).heldSeats).toBe(0);
    });
  });

  describe('only the owner (ACC-11)', () => {
    const body = { seats: [{ passengerIndex: 0, seatNumber: '2C' }] };

    it.each([
      [
        'PATCH :id/seat',
        (id: string, actor: Actor | null) => choose(id, body, actor),
      ],
      [
        'GET :id/seat-map',
        (id: string, actor: Actor | null) => seatMapOf(id, actor),
      ],
    ])(
      '%s answers another user 404, exactly as for a booking that does not exist',
      async (_label, call) => {
        const before = await seatsOf(family);

        const foreign = await call(family, other);
        const absent = await call(new Types.ObjectId().toString(), other);

        expect(foreign.status).toBe(404);
        expect(foreign.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
        expect(absent.status).toBe(404);
        expect(absent.body.message).toBe(foreign.body.message);
        expect(await seatsOf(family)).toEqual(before);
      },
    );

    it.each([
      [
        'PATCH :id/seat',
        (id: string, actor: Actor | null) => choose(id, body, actor),
      ],
      [
        'GET :id/seat-map',
        (id: string, actor: Actor | null) => seatMapOf(id, actor),
      ],
    ])('%s answers staff 403 and a guest 401', async (_label, call) => {
      for (const actor of [fx.admin, fx.moderator, fx.hotelModerator]) {
        const response = await call(family, actor);
        expect(response.status).toBe(403);
      }
      const guest = await call(family, null);
      expect(guest.status).toBe(401);
      expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents both routes with their DTOs and answers', async () => {
      const response = await fx.http().get('/api/docs-json').expect(200);
      const paths = response.body.paths as Record<
        string,
        Record<
          string,
          { requestBody?: unknown; responses: Record<string, unknown> }
        >
      >;
      const select = paths['/api/flight-bookings/{id}/seat'].patch;
      const map = paths['/api/flight-bookings/{id}/seat-map'].get;

      expect(JSON.stringify(select.requestBody)).toContain(
        '#/components/schemas/SelectSeatsDto',
      );
      expect(JSON.stringify(select.responses['200'])).toContain(
        '#/components/schemas/FlightBookingDetailsResponseDto',
      );
      expect(Object.keys(select.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
      );
      expect(JSON.stringify(map.responses['200'])).toContain(
        '#/components/schemas/SeatMapResponseDto',
      );
      expect(Object.keys(map.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404']),
      );
      const schemas = response.body.components.schemas as Record<
        string,
        { properties: Record<string, unknown> }
      >;
      expect(
        Object.keys(schemas.FlightBookingDetailsResponseDto.properties),
      ).toContain('seats');
      expect(
        Object.keys(schemas.FlightBookingListItemResponseDto.properties),
      ).toContain('seats');
      expect(Object.keys(schemas.SelectSeatsDto.properties).sort()).toEqual([
        'seats',
        'segmentIndex',
      ]);
    });
  });
});
