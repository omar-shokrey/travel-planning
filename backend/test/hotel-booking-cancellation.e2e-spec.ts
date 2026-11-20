import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { Types, type Model } from 'mongoose';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Role } from './../src/common/enums/role.enum';
import { CancelledBy } from './../src/flight-bookings/enums/cancelled-by.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import {
  CHECK_IN_REACHED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './../src/hotel-bookings/hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/hotel-bookings/hotel-bookings.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { Notification } from './../src/notifications/models/notification.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import {
  StripeGateway,
  type GatewayIntent,
  type GatewayRefund,
} from './../src/payments/stripe.gateway';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const RUN = `htl21-${randomUUID().slice(0, 8)}`;
const PRICE = 12500;

/** A date `days` after today (UTC). */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

interface Actor {
  id: string;
  cookie: string;
}

interface PaymentBody {
  id: string;
  stripePaymentIntentId: string;
  amount: number;
}

/**
 * HTL-21 end to end, on the "-test" database: a real reservation, accepted
 * policies, a payment (the Stripe calls replaced) and a webhook with the real
 * signature check confirm it and book its nights; then it is cancelled. The
 * refund call is replaced in every test, so nothing reaches Stripe. The app
 * starts with rawBody, like main.ts. Every record is deleted by id.
 */
describe('Hotel reservation cancellation (e2e, HTL-21)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;
  let bookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let refunds: Model<Refund>;
  let gateway: StripeGateway;
  let user: Actor;
  let other: Actor;
  let admin: Actor;
  let hotelId: string;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const userIds: string[] = [];
  const roomIds: string[] = [];
  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  let counter = 0;
  /** Each test books its own dates, so no two tests share a night. */
  let nextStay = 20;
  let roomNumber = 900;

  const http = () => request(app.getHttpServer());

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const createActor = async (label: string, role: Role): Promise<Actor> => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
    });
    const id = created._id.toString();
    userIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  const createRoom = async () => {
    const created = await rooms.create({
      hotelId: new Types.ObjectId(hotelId),
      number: String(++roomNumber),
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: PRICE,
      availability: [{ from: day(0), to: day(300) }],
    });
    const id = created._id.toString();
    roomIds.push(id);
    return id;
  };

  /** A stay of `nights` nights starting `startIn` days from now (or the next free one). */
  const newStay = (nights: number, startIn?: number) => {
    const from = startIn ?? nextStay;
    if (startIn === undefined) nextStay += nights + 1;
    return { checkIn: day(from), checkOut: day(from + nights) };
  };

  const reserve = async (
    roomList: string[],
    stay: { checkIn: string; checkOut: string },
    actor: Actor = user,
  ) =>
    http()
      .post('/api/hotel-bookings')
      .set('Cookie', actor.cookie)
      .send({
        hotelId,
        ...stay,
        rooms: roomList.map((roomId) => ({ roomId, adults: 1 })),
      });

  /** A reservation of `roomList` for `stay`, paid and confirmed with its nights booked. */
  const confirmed = async (
    roomList: string[],
    stay: { checkIn: string; checkOut: string },
  ): Promise<string> => {
    const created = await reserve(roomList, stay);
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    bookingIds.add(id);
    expect(
      (
        await http()
          .post(`/api/bookings/hotel/${id}/accept-policies`)
          .set('Cookie', user.cookie)
          .send({ accepted: true })
      ).status,
    ).toBe(200);
    const started = await http()
      .post('/api/payments')
      .set('Cookie', user.cookie)
      .send({ bookingType: 'hotel', bookingId: id });
    expect(started.status).toBe(201);
    const payment = started.body as PaymentBody;
    paymentIds.add(payment.id);

    const eventId = `evt_${RUN}_${++counter}`;
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
    const webhook = await http()
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
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
    return id;
  };

  const preview = (id: string, actor?: Actor) => {
    const call = http().get(`/api/hotel-bookings/${id}/cancel`);
    return actor ? call.set('Cookie', actor.cookie) : call;
  };

  const cancel = (id: string, body: unknown, actor?: Actor) => {
    const call = http().post(`/api/hotel-bookings/${id}/cancel`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as object,
    );
  };

  const storedBooking = (id: string) =>
    bookings.findById(id).lean().orFail().exec();

  const bookedNightsOf = (id: string) =>
    roomNights
      .find({ bookingId: new Types.ObjectId(id), state: RoomNightState.Booked })
      .lean()
      .exec();

  const refundsOf = (id: string) =>
    refunds
      .find({
        bookingType: BookingType.Hotel,
        bookingId: new Types.ObjectId(id),
      })
      .lean()
      .exec();

  /** PAY-03: the refund call, replaced in every test so nothing reaches Stripe. */
  let createRefund: jest.SpiedFunction<StripeGateway['createRefund']>;

  beforeEach(() => {
    createRefund = jest
      .spyOn(gateway, 'createRefund')
      .mockImplementation((refund) =>
        Promise.resolve<GatewayRefund>({
          id: `re_test_${RUN}_${++counter}`,
          status: 'pending',
          amount: refund.amount,
          currency: 'usd',
          paymentIntentId: refund.paymentIntentId,
        }),
      );
  });

  afterEach(() => {
    createRefund.mockRestore();
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    bookings = app.get<Model<HotelBooking>>(getModelToken(HotelBooking.name));
    payments = app.get<Model<Payment>>(getModelToken(Payment.name));
    stripeEvents = app.get<Model<StripeEvent>>(getModelToken(StripeEvent.name));
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    refunds = app.get<Model<Refund>>(getModelToken(Refund.name));
    await roomNights.init();
    await bookings.init();

    // Nothing reaches Stripe: only the signature check is real.
    gateway = app.get(StripeGateway);
    jest
      .spyOn(gateway, 'createPaymentIntent')
      .mockImplementation((intent) =>
        Promise.resolve(fakeIntent(`pi_${RUN}_${++counter}`, intent.amount)),
      );
    jest
      .spyOn(gateway, 'retrievePaymentIntent')
      .mockImplementation((id) => Promise.resolve(fakeIntent(id)));
    jest
      .spyOn(gateway, 'cancelPaymentIntent')
      .mockImplementation((id) =>
        Promise.resolve({ ...fakeIntent(id), status: 'canceled' }),
      );

    user = await createActor('user', Role.User);
    other = await createActor('other', Role.User);
    admin = await createActor('admin', Role.Admin);
    const hotel = await hotels.create({
      name: `HTL-21 hotel ${RUN}`,
      addressLine: '21 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-21 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      policy: {
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [
          { daysBefore: 2, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 100 },
        ],
      },
    });
    hotelId = hotel._id.toString();
  });

  afterAll(async () => {
    if (!app) return;
    jest.restoreAllMocks();
    try {
      for (const id of bookingIds) {
        for (const { _id } of await notifications
          .find({ linkId: id })
          .select('_id')
          .lean()
          .exec()) {
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
      for (const roomId of roomIds) {
        for (const { _id } of await roomNights
          .find({ roomId: new Types.ObjectId(roomId) })
          .select('_id')
          .lean()
          .exec()) {
          await roomNights.findByIdAndDelete(_id).exec();
        }
      }
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
      for (const id of roomIds) {
        await rooms.findByIdAndDelete(id).exec();
      }
      if (hotelId) {
        await hotels.findByIdAndDelete(hotelId).exec();
      }
      for (const id of userIds) {
        await deleteSessionsOf(app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await app.close();
    }
  });

  it('shows the refund of the tier for the days left, and changes nothing', async () => {
    const room = await createRoom();
    const stay = newStay(2);
    const id = await confirmed([room], stay);

    const response = await preview(id, user);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      bookingId: id,
      checkIn: stay.checkIn,
      daysRemaining: expect.any(Number),
      refundPercent: 100,
      total: 2 * PRICE,
      refundAmount: 2 * PRICE,
      currency: 'USD',
    });
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
    expect(await bookedNightsOf(id)).toHaveLength(2);
    expect(await refundsOf(id)).toHaveLength(0);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('cancels every room of a reservation: cancelled, all nights free again, one refund of the right amount', async () => {
    const first = await createRoom();
    const second = await createRoom();
    const stay = newStay(2);
    const id = await confirmed([first, second], stay);
    expect(await bookedNightsOf(id)).toHaveLength(4);

    const response = await cancel(id, { expectedRefundPercent: 100 }, user);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      bookingId: id,
      status: HotelBookingStatus.Cancelled,
      refundPercent: 100,
      total: 4 * PRICE,
      refundAmount: 4 * PRICE,
      refund: { amount: 4 * PRICE, currency: 'USD', refundPercent: 100 },
    });
    expect(response.body.cancelledAt).toMatch(/Z$/);
    const stored = await storedBooking(id);
    expect(stored).toMatchObject({
      status: HotelBookingStatus.Cancelled,
      cancelledBy: CancelledBy.User,
      refundPercent: 100,
    });
    expect(stored.cancelledAt?.toISOString()).toBe(response.body.cancelledAt);
    // Every night of both rooms is free again: another user can book them.
    expect(await bookedNightsOf(id)).toHaveLength(0);
    const again = await reserve([first, second], stay, other);
    expect(again.status).toBe(201);
    bookingIds.add((again.body as { id: string }).id);

    const saved = await refundsOf(id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      reason: RefundReason.UserCancellation,
      amount: 4 * PRICE,
      refundPercent: 100,
    });
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][1]).toBe(`refund-hotel-${id}`);
  });

  it('also frees nights still held when the confirmation had not booked them yet, so a retried confirmation finds nothing', async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));
    // As if the confirmation stopped between confirming and booking the nights.
    for (const night of await bookedNightsOf(id)) {
      await roomNights
        .updateOne(
          { _id: night._id },
          {
            $set: {
              state: RoomNightState.Held,
              holdExpiresAt: new Date(Date.now() + 30 * 60_000),
            },
          },
        )
        .exec();
    }

    const response = await cancel(id, { expectedRefundPercent: 100 }, user);

    expect(response.status).toBe(200);
    expect(
      await roomNights.countDocuments({ bookingId: new Types.ObjectId(id) }),
    ).toBe(0);
  });

  it('applies a lower tier closer to check-in: 50% of the total', async () => {
    const room = await createRoom();
    // 4 days ahead: the 2-day tier (50%) applies, not the 7-day one.
    const id = await confirmed([room], newStay(2, 4));

    const shown = await preview(id, user);
    expect(shown.body).toMatchObject({
      refundPercent: 50,
      refundAmount: PRICE,
    });

    const response = await cancel(id, { expectedRefundPercent: 50 }, user);

    expect(response.status).toBe(200);
    expect((await refundsOf(id))[0]).toMatchObject({ amount: PRICE });
  });

  it('answers 409 when the refund is not the one confirmed, and changes nothing', async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));

    const response = await cancel(id, { expectedRefundPercent: 50 }, user);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(REFUND_CHANGED_MESSAGE);
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
    expect(await bookedNightsOf(id)).toHaveLength(2);
    expect(await refundsOf(id)).toHaveLength(0);
  });

  it('cancels once when two cancellations arrive at the same moment', async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));

    const answers = await Promise.all([
      cancel(id, { expectedRefundPercent: 100 }, user),
      cancel(id, { expectedRefundPercent: 100 }, user),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await bookedNightsOf(id)).toHaveLength(0);
  });

  it('answers 409 for a reservation that is already cancelled, on both routes', async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));
    await cancel(id, { expectedRefundPercent: 100 }, user).expect(200);

    for (const response of [
      await preview(id, user),
      await cancel(id, { expectedRefundPercent: 100 }, user),
    ]) {
      expect(response.status).toBe(409);
      expect(response.body.message).toBe(NOT_CANCELLABLE_MESSAGE);
    }
    expect(await refundsOf(id)).toHaveLength(1);
  });

  it('answers 409 for a reservation still waiting for payment', async () => {
    const room = await createRoom();
    const created = await reserve([room], newStay(2));
    const id = (created.body as { id: string }).id;
    bookingIds.add(id);

    const response = await cancel(id, { expectedRefundPercent: 100 }, user);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(NOT_CANCELLABLE_MESSAGE);
    expect((await storedBooking(id)).status).toBe(
      HotelBookingStatus.PendingPayment,
    );
  });

  it.each([
    ['on the check-in date', 0],
    ['after the check-in date', -1],
  ])('answers 409 %s, and changes nothing', async (_case, offset) => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));
    // The check-in day has come or passed (this suite's own reservation).
    await bookings
      .updateOne(
        { _id: id },
        { $set: { checkIn: day(offset), checkOut: day(offset + 2) } },
      )
      .exec();

    for (const response of [
      await preview(id, user),
      await cancel(id, { expectedRefundPercent: 0 }, user),
    ]) {
      expect(response.status).toBe(409);
      expect(response.body.message).toBe(CHECK_IN_REACHED_MESSAGE);
    }
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
    expect(await bookedNightsOf(id)).toHaveLength(2);
  });

  it("answers 404 for another user's reservation or one that does not exist", async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));

    for (const response of [
      await preview(id, other),
      await cancel(id, { expectedRefundPercent: 100 }, other),
      await preview(new Types.ObjectId().toString(), user),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    }
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
  });

  it('needs a login (401) and a registered user (403)', async () => {
    const id = new Types.ObjectId().toString();

    expect((await preview(id)).status).toBe(401);
    expect((await cancel(id, { expectedRefundPercent: 100 })).status).toBe(401);
    expect((await preview(id, admin)).status).toBe(403);
    expect(
      (await cancel(id, { expectedRefundPercent: 100 }, admin)).status,
    ).toBe(403);
  });

  it('answers 400 for a bad id or body, naming the field', async () => {
    const room = await createRoom();
    const id = await confirmed([room], newStay(2));

    expect((await preview('not-an-id', user)).status).toBe(400);
    for (const body of [
      {},
      { expectedRefundPercent: 50.5 },
      { expectedRefundPercent: 101 },
      { expectedRefundPercent: 100, refundAmount: 1 },
    ]) {
      const response = await cancel(id, body, user);
      expect(response.status).toBe(400);
    }
    const missing = await cancel(id, {}, user);
    expect(missing.body.errors).toEqual([
      {
        field: 'expectedRefundPercent',
        messages: expect.arrayContaining(['expectedRefundPercent is required']),
      },
    ]);
    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
  });

  it('is documented in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const route = (
      response.body.paths as Record<
        string,
        Record<string, { responses: Record<string, unknown> }>
      >
    )['/api/hotel-bookings/{id}/cancel'];

    expect(Object.keys(route.get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
    expect(Object.keys(route.post.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });
});
