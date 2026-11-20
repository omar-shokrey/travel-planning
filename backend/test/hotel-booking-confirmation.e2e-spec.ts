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
import { HOTEL_REFERENCE_PATTERN } from './../src/hotel-bookings/booking-reference';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingExpiryService } from './../src/hotel-bookings/hotel-booking-expiry.service';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { NotificationLinkType } from './../src/notifications/enums/notification-link-type.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { Payment } from './../src/payments/models/payment.schema';
import { StripeEvent } from './../src/payments/models/stripe-event.schema';
import {
  StripeGateway,
  type GatewayIntent,
} from './../src/payments/stripe.gateway';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';
import { TEST_STRIPE_WEBHOOK_SECRET } from './support/stripe-env';

const RUN = `htl17-${randomUUID().slice(0, 8)}`;
const MINUTE_MS = 60_000;

/** A date `days` after today (UTC), so the stay never falls in the past. */
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
 * HTL-17 end to end, on the "-test" database: a real reservation (HTL-16,
 * HTL-18), accepted policies (PAY-02) and payment (PAY-01), then a webhook
 * signed with the real Stripe signature check confirms it. Only the three
 * gateway calls that would reach Stripe are replaced. The app is started
 * with rawBody, like main.ts, for the signature check. Every record is
 * deleted by id.
 */
describe('Hotel reservation confirmation (e2e, HTL-17)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;
  let bookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let stripeEvents: Model<StripeEvent>;
  let notifications: Model<Notification>;
  let user: Actor;
  let otherUser: Actor;
  let hotelId: string;
  const signer = new Stripe('sk_test_e2e_signer_only');

  const userIds: string[] = [];
  const hotelIds: string[] = [];
  const roomIds: string[] = [];
  const bookingIds = new Set<string>();
  const paymentIds = new Set<string>();
  const eventIds = new Set<string>();
  let counter = 0;
  /** Each test books its own dates, so no two tests share a night. */
  let nextStay = 10;

  const http = () => request(app.getHttpServer());

  const fakeIntent = (id: string, amount = 0): GatewayIntent => ({
    id,
    status: 'requires_payment_method',
    clientSecret: `${id}_secret_e2e`,
    amount,
    currency: 'usd',
  });

  const createActor = async (label: string): Promise<Actor> => {
    const created = await users.create({
      name: `${RUN} ${label}`,
      email: `${RUN}-${label}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      consentAcceptedAt: new Date(),
    });
    const id = created._id.toString();
    userIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  const createRoom = async (number: string, type: string) => {
    const created = await rooms.create({
      hotelId: new Types.ObjectId(hotelId),
      number,
      type,
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      availability: [{ from: day(0), to: day(200) }],
    });
    const id = created._id.toString();
    roomIds.push(id);
    return id;
  };

  /** A new stay of `nights` nights that no other test uses. */
  const newStay = (nights: number) => {
    const from = nextStay;
    nextStay += nights + 1;
    return { checkIn: day(from), checkOut: day(from + nights) };
  };

  /** Reserves the rooms through the real route and accepts the policies. */
  const reserve = async (
    roomList: string[],
    stay: { checkIn: string; checkOut: string },
    actor: Actor = user,
  ): Promise<string> => {
    const created = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', actor.cookie)
      .send({
        hotelId,
        ...stay,
        rooms: roomList.map((roomId, index) => ({
          roomId,
          adults: 1,
          ...(index === 1 ? { childAges: [7] } : {}),
        })),
      });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    bookingIds.add(id);
    const accepted = await http()
      .post(`/api/bookings/hotel/${id}/accept-policies`)
      .set('Cookie', actor.cookie)
      .send({ accepted: true });
    expect(accepted.status).toBe(200);
    return id;
  };

  const startPayment = async (bookingId: string): Promise<PaymentBody> => {
    const response = await http()
      .post('/api/payments')
      .set('Cookie', user.cookie)
      .send({ bookingType: 'hotel', bookingId });
    expect(response.status).toBe(201);
    const body = response.body as PaymentBody;
    paymentIds.add(body.id);
    return body;
  };

  /** Sends `payment_intent.succeeded`, signed with the test secret. */
  const paid = (payment: PaymentBody, eventId = `evt_${RUN}_${++counter}`) => {
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

  const storedBooking = (id: string) =>
    bookings.findById(id).lean().orFail().exec();

  const nightsOf = (bookingId: string) =>
    roomNights
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .lean()
      .exec();

  const notificationsOf = (bookingId: string) =>
    notifications.find({ userId: user.id, linkId: bookingId }).lean().exec();

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
    // The unique (roomId, date) and reference indexes must exist.
    await roomNights.init();
    await bookings.init();

    // Nothing reaches Stripe: only the signature check is real.
    const gateway = app.get(StripeGateway);
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

    user = await createActor('user');
    otherUser = await createActor('other');
    const hotel = await hotels.create({
      name: `HTL-17 hotel ${RUN}`,
      addressLine: '17 Nile Street',
      cityId: `${RUN}-city`,
      countryCode: 'QZ',
      description: 'A hotel created by the HTL-17 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
      policy: {
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
      },
    });
    hotelId = hotel._id.toString();
    hotelIds.push(hotelId);
  });

  afterAll(async () => {
    if (!app) return;
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
      for (const roomId of roomIds) {
        const nights = await roomNights
          .find({ roomId: new Types.ObjectId(roomId) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of nights) {
          await roomNights.findByIdAndDelete(_id).exec();
        }
      }
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
      for (const id of roomIds) {
        await rooms.findByIdAndDelete(id).exec();
      }
      for (const id of hotelIds) {
        await hotels.findByIdAndDelete(id).exec();
      }
      for (const id of userIds) {
        await deleteSessionsOf(app, id);
        await users.findByIdAndDelete(id).exec();
      }
    } finally {
      await app.close();
    }
  });

  it('confirms all the rooms after a verified payment: a reference, every night booked, one notification', async () => {
    const double = await createRoom('701', 'Double');
    const family = await createRoom('702', 'Family');
    const stay = newStay(3);
    const id = await reserve([double, family], stay);
    expect(await nightsOf(id)).toHaveLength(6);
    const payment = await startPayment(id);

    const webhook = await paid(payment);

    expect(webhook.status).toBe(200);
    const stored = await storedBooking(id);
    expect(stored.status).toBe(HotelBookingStatus.Confirmed);
    expect(stored.reference).toMatch(HOTEL_REFERENCE_PATTERN);
    // 2 rooms x 3 nights, all booked, none with a hold end.
    const nights = await nightsOf(id);
    expect(nights).toHaveLength(6);
    for (const night of nights) {
      expect(night.state).toBe(RoomNightState.Booked);
      expect(night.holdExpiresAt).toBeUndefined();
    }

    const sent = await notificationsOf(id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: NotificationType.BookingConfirmed,
      linkType: NotificationLinkType.HotelBooking,
      message: `Your reservation ${stored.reference} at HTL-17 hotel ${RUN} is confirmed: check-in ${stay.checkIn}, check-out ${stay.checkOut} (3 nights), 2 rooms (701 (Double), 702 (Family)), 2 adults and 1 child.`,
    });
  });

  it('changes nothing when the same payment is reported again, by the same event or a new one', async () => {
    const room = await createRoom('703', 'Double');
    const id = await reserve([room], newStay(2));
    const payment = await startPayment(id);
    const eventId = `evt_${RUN}_repeat_${id}`;
    await paid(payment, eventId);
    const first = await storedBooking(id);

    const sameEvent = await paid(payment, eventId);
    const newEvent = await paid(payment);

    expect(sameEvent.status).toBe(200);
    expect(newEvent.status).toBe(200);
    const after = await storedBooking(id);
    expect(after.status).toBe(HotelBookingStatus.Confirmed);
    expect(after.reference).toBe(first.reference);
    expect(
      (await nightsOf(id)).every((n) => n.state === RoomNightState.Booked),
    ).toBe(true);
    expect(await notificationsOf(id)).toHaveLength(1);
  });

  it('does not confirm a payment that arrives after the hold ended, and only notifies the refund (PAY-03)', async () => {
    const room = await createRoom('704', 'Double');
    const id = await reserve([room], newStay(2));
    const payment = await startPayment(id);
    // The hold ends before Stripe reports the payment (this suite's own records).
    const ended = new Date(Date.now() - MINUTE_MS);
    await bookings
      .updateOne({ _id: id }, { $set: { holdExpiresAt: ended } })
      .exec();
    for (const night of await nightsOf(id)) {
      await roomNights
        .updateOne({ _id: night._id }, { $set: { holdExpiresAt: ended } })
        .exec();
    }

    const webhook = await paid(payment);

    expect(webhook.status).toBe(200);
    const stored = await storedBooking(id);
    expect(stored.status).not.toBe(HotelBookingStatus.Confirmed);
    expect(stored.reference).toBeUndefined();
    expect(
      (await nightsOf(id)).some((n) => n.state === RoomNightState.Booked),
    ).toBe(false);
    // PAY-03: the late payment is refunded in full and the user is told so.
    // There is no booking confirmation.
    const sent = await notificationsOf(id);
    expect(sent.map((n) => n.type)).toEqual([NotificationType.Refund]);
  });

  it('the expiry job never releases a confirmed reservation, even once its old hold end has passed', async () => {
    const room = await createRoom('705', 'Double');
    const id = await reserve([room], newStay(2));
    await paid(await startPayment(id));
    // Move this confirmed reservation's old hold end into the past.
    await bookings
      .updateOne(
        { _id: id },
        { $set: { holdExpiresAt: new Date(Date.now() - MINUTE_MS) } },
      )
      .exec();

    // `now` is the real time, as the cron job of every e2e app uses: live holds
    // of other suites are never touched (ended ones would be expired by the cron too).
    await app.get(HotelBookingExpiryService).expireDueHolds(new Date());

    expect((await storedBooking(id)).status).toBe(HotelBookingStatus.Confirmed);
    const nights = await nightsOf(id);
    expect(nights).toHaveLength(2);
    expect(nights.every((n) => n.state === RoomNightState.Booked)).toBe(true);
  });

  it('a confirmed reservation still keeps its rooms: another reservation of the same room and dates is 409', async () => {
    const room = await createRoom('706', 'Double');
    const stay = newStay(2);
    const id = await reserve([room], stay);
    await paid(await startPayment(id));

    const second = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', otherUser.cookie)
      .send({ hotelId, ...stay, rooms: [{ roomId: room, adults: 1 }] });

    expect(second.status).toBe(409);
    expect(await nightsOf(id)).toHaveLength(2);
  });
});
