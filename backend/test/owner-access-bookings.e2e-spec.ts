import './support/auth-env';
import './support/stripe-env';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { PLATFORM_CURRENCY } from './../src/common/constants/currency';
import { IS_PUBLIC_KEY } from './../src/common/decorators/public.decorator';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from './../src/flight-bookings/enums/passenger-type.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './../src/flight-bookings/flight-bookings.service';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { FOREIGN_FLIGHT_MESSAGE } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { ReviewModeration } from './../src/hotel-bookings/enums/review-moderation.enum';
import {
  REVIEW_EXISTS_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
} from './../src/hotel-bookings/hotel-bookings.constants';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import { Notification } from './../src/notifications/models/notification.schema';
import { Review } from './../src/hotel-bookings/models/review.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { BookingType } from './../src/payments/enums/booking-type.enum';
import { PaymentStatus } from './../src/payments/enums/payment-status.enum';
import { Payment } from './../src/payments/models/payment.schema';
import {
  ALREADY_PAID_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
} from './../src/payments/payments.constants';
import { RefundReason } from './../src/payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from './../src/payments/refunds/enums/refund-status.enum';
import { Refund } from './../src/payments/refunds/models/refund.schema';
import { REFUND_NOT_FOUND_MESSAGE } from './../src/payments/refunds/refunds.constants';
import { StripeGateway } from './../src/payments/stripe.gateway';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { sessionCookieFor } from './support/session-cookie';

/** The answer of the roles guard to a role a route does not allow. */
const ROLE_REFUSED_MESSAGE =
  'You do not have permission to perform this action';
/** The answer of HotelsService to the moderator of another hotel. */
const FOREIGN_HOTEL_MESSAGE = 'You do not manage this hotel';
/**
 * Every route is sent by up to eight actors, each with a few database round
 * trips, so the matrix tests get more than the default 30 seconds.
 */
const MANY_REQUESTS_TIMEOUT = 180_000;
/** The day the seeded bookings were made, for the admin list (ACC-17). */
const SEED_DAY = '2001-05-07';
const SEED_TIME = new Date(`${SEED_DAY}T10:00:00.000Z`);

const VERBS = {
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;
type Verb = keyof typeof VERBS;

/** The ids of one owner's records, or of records that do not exist. */
interface RecordIds {
  flightBooking: string;
  hotelBooking: string;
  /** A confirmed reservation whose check-in is far away, so it can be cancelled. */
  upcomingHotelBooking: string;
  payment: string;
  refund: string;
  review: string;
}

/** One owner-only route, with a body that passes validation. */
interface OwnerRoute {
  /** As the route table names it, for example `GET /api/refunds/:id`. */
  label: string;
  verb: Verb;
  path: (ids: RecordIds) => string;
  body?: (ids: RecordIds) => Record<string, unknown>;
  /** The 404 message for a record that is not the caller's. */
  notFound: string;
  /**
   * What the owner gets: 200, or 409 when the route reaches the record and
   * refuses only its state (the ownership check passed, nothing changed).
   * `null` when the owner's call would change data: those routes are tested
   * for their owner in their own suites.
   */
  owner: 200 | 409 | null;
  /** With 409: the message that shows which state refused the owner. */
  ownerMessage?: string;
  /** With 200: the owner's record whose id the answer must contain. */
  ownerShows?: keyof RecordIds;
  /** With 200: the content type of an answer that is not JSON. */
  ownerType?: string;
}

/** One route for staff of a provider, or for admins. */
interface ProviderRoute {
  label: string;
  path: () => string;
  verb: Verb;
  /** The one role that is served: never part of the refusals below. */
  allowed: StaffLabel;
  /** `false` when the allowed call would change data: it is then never sent. */
  sendAllowed: boolean;
  /** Staff of the same role but another provider, and their 403 message. */
  foreign?: { actor: StaffLabel; message: string };
  /** What the allowed actor's answer must contain. */
  shows?: () => string[];
  /** A body that passes validation, so only the access checks can refuse. */
  body?: () => Record<string, unknown>;
  /** A check of the stored data after every refused request. */
  unchanged?: () => Promise<void>;
}

type StaffLabel =
  | 'admin'
  | 'airlineModerator'
  | 'otherAirlineModerator'
  | 'hotelModerator'
  | 'otherHotelModerator';
type ActorLabel = 'owner' | 'otherUser' | StaffLabel;

/** The metadata keys that `@Controller()` and `@Get()`, `@Post()`, ... set. */
const PATH_KEY = 'path';
const METHOD_KEY = 'method';

const asList = (path: string | string[] | undefined): string[] =>
  Array.isArray(path) ? path : [path ?? ''];
const joinPath = (...parts: string[]): string =>
  `/${parts
    .join('/')
    .split('/')
    .filter((part) => part !== '')
    .join('/')}`;

/**
 * Which routes of the app this file must cover: every route of the booking
 * areas, and every route elsewhere whose path names bookings, reservations,
 * passengers, payments, refunds or reviews.
 */
const BOOKING_AREAS = [
  '/api/flight-bookings',
  '/api/hotel-bookings',
  '/api/bookings',
  '/api/payments',
  '/api/refunds',
  '/api/reviews',
];
const BOOKING_WORDS =
  /booking|reservation|passenger|payment|refund|review|\/cancel$/;

/**
 * ACC-11, booking part: "restrict access to bookings ... to their owner,
 * except that admins may view all bookings (ACC-17) and moderators may view
 * bookings for their own hotel or airline (FLT-29, HTL-22). Unauthorised
 * requests shall be rejected (403/404)."
 *
 * Every booking-family route is sent by the owner, another registered user,
 * an admin, the moderators of the right and of another airline and hotel, and
 * a guest:
 * - On an owner route (`@Roles(Role.User)`), another user gets the same 404
 *   as for a record that does not exist, so ids reveal nothing; staff get 403
 *   from the role check; a guest gets 401. Nothing changes.
 * - Admins read every booking only through `GET /api/admin/bookings`
 *   (ACC-17); moderators read only the bookings of their own airline or
 *   hotel; staff of another provider get 403.
 * - The owner always comes from the login: an owner id in a query or a body
 *   is refused (400).
 *
 * The records are seeded straight into the "-test" database and deleted one
 * by one by id afterwards. The app's scheduled jobs are stopped. Stripe is
 * never called: every gateway method that calls Stripe is replaced by a stub
 * that fails, and the test checks that none was used.
 * Private itineraries and the own account are in owner-access.e2e-spec.ts.
 */
describe('Owner-only access to bookings (e2e, ACC-11)', () => {
  let fx: FlightFixture;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let reviews: Model<Review>;
  let stripeCalls: jest.SpyInstance[] = [];

  const createdUserIds: string[] = [];
  const createdHotelIds: Types.ObjectId[] = [];
  const actors = new Map<ActorLabel, Actor>();
  let flightId = '';
  const hotelId = new Types.ObjectId();
  const otherHotelId = new Types.ObjectId();
  const reference = (prefix: string) =>
    `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
  const flightReference = reference('FB');
  const hotelReference = reference('HB');
  const passengerName = `ACC-11 Passenger ${randomUUID().slice(0, 6)}`;

  const own: RecordIds = {
    flightBooking: new Types.ObjectId().toString(),
    hotelBooking: new Types.ObjectId().toString(),
    upcomingHotelBooking: new Types.ObjectId().toString(),
    payment: new Types.ObjectId().toString(),
    refund: new Types.ObjectId().toString(),
    review: new Types.ObjectId().toString(),
  };
  /** Ids that no record has: the answer must be the same as for another user's. */
  const missing = (): RecordIds => ({
    flightBooking: new Types.ObjectId().toString(),
    hotelBooking: new Types.ObjectId().toString(),
    upcomingHotelBooking: new Types.ObjectId().toString(),
    payment: new Types.ObjectId().toString(),
    refund: new Types.ObjectId().toString(),
    review: new Types.ObjectId().toString(),
  });

  const OWNER_ROUTES: OwnerRoute[] = [
    {
      label: 'GET /api/flight-bookings/:id',
      verb: 'GET',
      path: (ids) => `/api/flight-bookings/${ids.flightBooking}`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'flightBooking',
    },
    {
      label: 'GET /api/flight-bookings/:id/e-ticket',
      verb: 'GET',
      path: (ids) => `/api/flight-bookings/${ids.flightBooking}/e-ticket`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerType: 'application/pdf',
    },
    {
      label: 'GET /api/flight-bookings/:id/cancel',
      verb: 'GET',
      path: (ids) => `/api/flight-bookings/${ids.flightBooking}/cancel`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'flightBooking',
    },
    {
      label: 'POST /api/flight-bookings/:id/cancel',
      verb: 'POST',
      path: (ids) => `/api/flight-bookings/${ids.flightBooking}/cancel`,
      body: () => ({ expectedRefundPercent: 0 }),
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: null,
    },
    {
      label: 'GET /api/hotel-bookings/:id',
      verb: 'GET',
      path: (ids) => `/api/hotel-bookings/${ids.hotelBooking}`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'hotelBooking',
    },
    {
      label: 'GET /api/hotel-bookings/:id/cancel',
      verb: 'GET',
      path: (ids) => `/api/hotel-bookings/${ids.upcomingHotelBooking}/cancel`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'upcomingHotelBooking',
    },
    {
      label: 'POST /api/hotel-bookings/:id/cancel',
      verb: 'POST',
      path: (ids) => `/api/hotel-bookings/${ids.upcomingHotelBooking}/cancel`,
      body: () => ({ expectedRefundPercent: 0 }),
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: null,
    },
    {
      // The owner's stay already has a review: 409, and nothing is written.
      label: 'POST /api/hotel-bookings/:id/review',
      verb: 'POST',
      path: (ids) => `/api/hotel-bookings/${ids.hotelBooking}/review`,
      body: () => ({ rating: 4 }),
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 409,
      ownerMessage: REVIEW_EXISTS_MESSAGE,
    },
    {
      label: 'PATCH /api/reviews/:id',
      verb: 'PATCH',
      path: (ids) => `/api/reviews/${ids.review}`,
      body: () => ({ rating: 1 }),
      notFound: REVIEW_NOT_FOUND_MESSAGE,
      owner: null,
    },
    {
      label: 'DELETE /api/reviews/:id',
      verb: 'DELETE',
      path: (ids) => `/api/reviews/${ids.review}`,
      notFound: REVIEW_NOT_FOUND_MESSAGE,
      owner: null,
    },
    {
      // The booking is in the body. It is confirmed, so the owner gets 409.
      label: 'POST /api/payments',
      verb: 'POST',
      path: () => '/api/payments',
      body: (ids) => ({
        bookingType: BookingType.Flight,
        bookingId: ids.flightBooking,
      }),
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 409,
      ownerMessage: NOT_WAITING_FOR_PAYMENT_MESSAGE,
    },
    {
      // The payment succeeded, so the owner's retry is 409.
      label: 'POST /api/payments/:id/retry',
      verb: 'POST',
      path: (ids) => `/api/payments/${ids.payment}/retry`,
      notFound: PAYMENT_NOT_FOUND_MESSAGE,
      owner: 409,
      ownerMessage: ALREADY_PAID_MESSAGE,
    },
    {
      label: 'GET /api/payments/:id',
      verb: 'GET',
      path: (ids) => `/api/payments/${ids.payment}`,
      notFound: PAYMENT_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'payment',
    },
    {
      label: 'GET /api/refunds/:id',
      verb: 'GET',
      path: (ids) => `/api/refunds/${ids.refund}`,
      notFound: REFUND_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'refund',
    },
    {
      label: 'GET /api/bookings/:type/:id/policies',
      verb: 'GET',
      path: (ids) => `/api/bookings/flight/${ids.flightBooking}/policies`,
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'flightBooking',
    },
    {
      // Already accepted: the stored answer comes back and nothing is written.
      label: 'POST /api/bookings/:type/:id/accept-policies',
      verb: 'POST',
      path: (ids) =>
        `/api/bookings/flight/${ids.flightBooking}/accept-policies`,
      body: () => ({ accepted: true }),
      notFound: BOOKING_NOT_FOUND_MESSAGE,
      owner: 200,
      ownerShows: 'flightBooking',
    },
  ];

  /** The lists of the owner's own bookings: they never show anyone else's. */
  const LIST_ROUTES = [
    'GET /api/flight-bookings',
    'GET /api/hotel-bookings',
  ] as const;

  /** Routes that create a booking: the owner is the login, nothing else. */
  const CREATE_ROUTES = [
    'POST /api/flight-bookings',
    'POST /api/flight-bookings/hold',
    'POST /api/hotel-bookings',
  ] as const;

  const PROVIDER_ROUTES: ProviderRoute[] = [
    {
      label: 'GET /api/admin/bookings',
      verb: 'GET',
      path: () =>
        `/api/admin/bookings?from=${SEED_DAY}&to=${SEED_DAY}&limit=50`,
      allowed: 'admin',
      sendAllowed: true,
      shows: () => [own.flightBooking, own.hotelBooking],
    },
    {
      label: 'GET /api/flights/:id/bookings',
      verb: 'GET',
      path: () => `/api/flights/${flightId}/bookings`,
      allowed: 'airlineModerator',
      sendAllowed: true,
      foreign: {
        actor: 'otherAirlineModerator',
        message: FOREIGN_FLIGHT_MESSAGE,
      },
      shows: () => [flightReference],
    },
    {
      label: 'GET /api/flights/:id/passengers/export',
      verb: 'GET',
      path: () => `/api/flights/${flightId}/passengers/export`,
      allowed: 'airlineModerator',
      sendAllowed: true,
      foreign: {
        actor: 'otherAirlineModerator',
        message: FOREIGN_FLIGHT_MESSAGE,
      },
      shows: () => [passengerName],
    },
    {
      // Cancelling the flight would cancel the booking: only refusals are sent.
      label: 'POST /api/flights/:id/cancel',
      verb: 'POST',
      path: () => `/api/flights/${flightId}/cancel`,
      allowed: 'airlineModerator',
      sendAllowed: false,
      foreign: {
        actor: 'otherAirlineModerator',
        message: FOREIGN_FLIGHT_MESSAGE,
      },
    },
    {
      label: 'GET /api/hotels/:id/reservations',
      verb: 'GET',
      path: () => `/api/hotels/${hotelId.toString()}/reservations`,
      allowed: 'hotelModerator',
      sendAllowed: true,
      foreign: { actor: 'otherHotelModerator', message: FOREIGN_HOTEL_MESSAGE },
      shows: () => [hotelReference],
    },
    {
      // HTL-26. The roles guard refuses every role but a hotel moderator;
      // then the review's hotel must be the moderator's own (HotelsService.
      // findManagedEntityOrThrow). The reply writes, so the right moderator
      // is never sent: test/hotel-review-replies.e2e-spec.ts covers it.
      label: 'POST /api/reviews/:id/reply',
      verb: 'POST',
      path: () => `/api/reviews/${own.review}/reply`,
      body: () => ({ text: 'A reply that must never be stored.' }),
      allowed: 'hotelModerator',
      sendAllowed: false,
      foreign: { actor: 'otherHotelModerator', message: FOREIGN_HOTEL_MESSAGE },
      unchanged: async () => {
        const review = await reviews.findById(own.review).lean().exec();
        expect(review).not.toBeNull();
        expect(review?.reply).toBeUndefined();
      },
    },
  ];

  /** Public on purpose: the payment webhook (checked by its Stripe signature) and the reviews of a hotel (HTL-24). */
  const PUBLIC_ROUTES = [
    'POST /api/payments/webhook',
    'GET /api/hotels/:id/reviews',
  ] as const;

  const STAFF: StaffLabel[] = [
    'admin',
    'airlineModerator',
    'otherAirlineModerator',
    'hotelModerator',
    'otherHotelModerator',
  ];

  const cookieOf = (label: ActorLabel): string => {
    const actor = actors.get(label);
    if (!actor) throw new Error(`No actor ${label}`);
    return actor.cookie;
  };

  /** Sends a request, as an actor or (with `null`) as a guest. */
  const send = (
    verb: Verb,
    path: string,
    as: ActorLabel | null,
    body?: Record<string, unknown>,
  ) => {
    let call = fx.http()[VERBS[verb]](path);
    if (as) call = call.set('Cookie', cookieOf(as));
    return body ? call.send(body) : call;
  };

  /** An error body without what names the request itself (its path and time). */
  const withoutRequestFields = (body: Record<string, unknown>) => {
    const { path: _path, timestamp: _timestamp, ...rest } = body;
    return rest;
  };

  const ownerCall = (route: OwnerRoute, as: ActorLabel | null, ids = own) =>
    send(route.verb, route.path(ids), as, route.body?.(ids));

  /** The stored state an outsider must never change. */
  const snapshot = async () => ({
    flightBooking: await flightBookings
      .findById(own.flightBooking)
      .lean()
      .exec(),
    hotelBooking: await hotelBookings.findById(own.hotelBooking).lean().exec(),
    upcoming: await hotelBookings
      .findById(own.upcomingHotelBooking)
      .lean()
      .exec(),
    payment: await payments.findById(own.payment).lean().exec(),
    refund: await refunds.findById(own.refund).lean().exec(),
    review: await reviews.findById(own.review).lean().exec(),
    flight: await fx.flights.findById(flightId).lean().exec(),
  });

  const createActor = async (
    label: ActorLabel,
    role: Role,
    assignment?: { providerType: ProviderType; providerId: Types.ObjectId },
  ): Promise<void> => {
    const user = await users.create({
      name: `ACC-11 ${label} ${fx.run}`,
      email: `${fx.run}-${label.toLowerCase()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(assignment && { assignment }),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    actors.set(label, { id, cookie: await sessionCookieFor(fx.app, id) });
  };

  beforeAll(async () => {
    fx = await createFlightFixture('acc11b');
    const model = <T>(name: string) =>
      fx.app.get<Model<T>>(getModelToken(name));
    users = model<User>(User.name);
    hotels = model<Hotel>(Hotel.name);
    flightBookings = model<FlightBooking>(FlightBooking.name);
    hotelBookings = model<HotelBooking>(HotelBooking.name);
    payments = model<Payment>(Payment.name);
    refunds = model<Refund>(Refund.name);
    reviews = model<Review>(Review.name);

    // The jobs of this app (holds, completion, refund recovery, ...) would act
    // on every record of the "-test" database, also other suites': stop them,
    // so this file changes only its own records and "never called Stripe" is
    // about the requests below.
    const scheduler = fx.app.get(SchedulerRegistry);
    for (const job of scheduler.getCronJobs().values()) {
      await job.stop();
    }

    // No request here may reach Stripe: a call fails loudly and is counted.
    const gateway = fx.app.get(StripeGateway);
    stripeCalls = (
      [
        'createPaymentIntent',
        'retrievePaymentIntent',
        'cancelPaymentIntent',
        'createRefund',
      ] as const
    ).map((method) =>
      jest
        .spyOn(gateway, method)
        .mockRejectedValue(new Error('Stripe must not be called here')),
    );

    actors.set('owner', fx.user);
    actors.set('admin', fx.admin);
    actors.set('airlineModerator', fx.moderator);
    actors.set('otherAirlineModerator', fx.otherModerator);

    for (const [_id, name] of [
      [hotelId, 'Hotel'],
      [otherHotelId, 'Other hotel'],
    ] as const) {
      createdHotelIds.push(_id);
      await hotels.create({
        _id,
        name: `ACC-11 ${name} ${fx.run}`,
        addressLine: '1 Test Street',
        cityId: `${fx.run}-city`,
        countryCode: 'EG',
        description: 'A hotel created by the ACC-11 bookings e2e test.',
        starClass: 3,
      });
    }
    await createActor('otherUser', Role.User);
    await createActor('hotelModerator', Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: hotelId,
    });
    await createActor('otherHotelModerator', Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: otherHotelId,
    });

    const cabin = fx.storedCabin({ bookedSeats: 1 });
    flightId = await fx.insertFlight({
      departureAt: new Date(Date.now() + 60 * 86_400_000),
      cabins: [cabin],
    });
    const owner = new Types.ObjectId(fx.user.id);

    // Through the driver, so the backdated createdAt stays (still "-test").
    await flightBookings.collection.insertOne({
      _id: new Types.ObjectId(own.flightBooking),
      reference: flightReference,
      userId: owner,
      status: FlightBookingStatus.Confirmed,
      policyAcceptedAt: SEED_TIME,
      currency: PLATFORM_CURRENCY,
      fareTotal: 10000,
      baggageTotal: 0,
      total: 10000,
      segments: [
        {
          flightId: new Types.ObjectId(flightId),
          airlineId: new Types.ObjectId(fx.airlineId),
          cabin: CabinClass.Economy,
          fare: 10000,
          seatsReserved: 1,
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
          maxExtraBags: 0,
        },
      ],
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      passengers: [
        {
          fullName: passengerName,
          dateOfBirth: '1990-05-14',
          passportNumber: 'ACC11PASS1',
          type: PassengerType.Adult,
          baggage: [],
        },
      ],
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    });
    const room = {
      roomId: new Types.ObjectId(),
      roomLabel: '101 (Double)',
      pricePerNight: 15000,
      adults: 2,
      childAges: [],
    };
    await hotelBookings.collection.insertMany([
      {
        _id: new Types.ObjectId(own.hotelBooking),
        reference: hotelReference,
        userId: owner,
        hotelId,
        checkIn: '2001-05-20',
        checkOut: '2001-05-22',
        nights: 2,
        status: HotelBookingStatus.Completed,
        currency: PLATFORM_CURRENCY,
        total: 30000,
        rooms: [room],
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
        policyAcceptedAt: SEED_TIME,
        createdAt: SEED_TIME,
        updatedAt: SEED_TIME,
      },
      {
        _id: new Types.ObjectId(own.upcomingHotelBooking),
        reference: reference('HB'),
        userId: owner,
        hotelId,
        checkIn: '2099-05-20',
        checkOut: '2099-05-22',
        nights: 2,
        status: HotelBookingStatus.Confirmed,
        currency: PLATFORM_CURRENCY,
        total: 30000,
        rooms: [room],
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
        policyAcceptedAt: SEED_TIME,
        createdAt: SEED_TIME,
        updatedAt: SEED_TIME,
      },
    ]);
    await payments.collection.insertOne({
      _id: new Types.ObjectId(own.payment),
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(own.flightBooking),
      userId: owner,
      stripePaymentIntentId: `pi_acc11_${randomUUID().replaceAll('-', '')}`,
      amount: 10000,
      currency: PLATFORM_CURRENCY,
      status: PaymentStatus.Succeeded,
      holdExpiresAt: SEED_TIME,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    });
    await refunds.collection.insertOne({
      _id: new Types.ObjectId(own.refund),
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(own.flightBooking),
      paymentId: new Types.ObjectId(own.payment),
      userId: owner,
      amount: 5000,
      currency: PLATFORM_CURRENCY,
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
      status: RefundStatus.Refunded,
      stripeRefundId: `re_acc11_${randomUUID().replaceAll('-', '')}`,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    });
    await reviews.collection.insertOne({
      _id: new Types.ObjectId(own.review),
      hotelId,
      userId: owner,
      bookingId: new Types.ObjectId(own.hotelBooking),
      rating: 5,
      text: 'The owner wrote this.',
      moderation: ReviewModeration.Visible,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    });
  }, MANY_REQUESTS_TIMEOUT);

  afterAll(async () => {
    for (const spy of stripeCalls) spy.mockRestore();
    if (!fx) return;
    // Nothing here may create a refund or a notification. If a regression
    // lets an outsider through, delete what it made too, one by one by id.
    const notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    for (const bookingId of [own.flightBooking, own.upcomingHotelBooking]) {
      for (const { _id } of await refunds
        .find({ bookingId: new Types.ObjectId(bookingId) })
        .select('_id')
        .lean()
        .exec()) {
        await refunds.deleteOne({ _id });
      }
    }
    for (const { _id } of await notifications
      .find({ userId: new Types.ObjectId(fx.user.id) })
      .select('_id')
      .lean()
      .exec()) {
      await notifications.deleteOne({ _id });
    }
    await reviews.deleteOne({ _id: own.review });
    await refunds.deleteOne({ _id: own.refund });
    await payments.deleteOne({ _id: own.payment });
    await hotelBookings.deleteOne({ _id: own.hotelBooking });
    await hotelBookings.deleteOne({ _id: own.upcomingHotelBooking });
    await flightBookings.deleteOne({ _id: own.flightBooking });
    for (const id of createdHotelIds) {
      await hotels.deleteOne({ _id: id });
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(fx.app, id);
      await users.deleteOne({ _id: id });
    }
    // The fixture deletes its own flight, airlines, airports and accounts.
    await fx.cleanup();
  });

  describe('owner routes', () => {
    it.each(OWNER_ROUTES.filter((route) => route.owner !== null))(
      'serves the owner on $label (status $owner, nothing changed)',
      async (route) => {
        const before = await snapshot();

        const response = await ownerCall(route, 'owner');

        expect(response.status).toBe(route.owner);
        if (route.ownerMessage) {
          expect(response.body.message).toBe(route.ownerMessage);
        }
        if (route.ownerShows) {
          expect(response.text).toContain(own[route.ownerShows]);
        }
        if (route.ownerType) {
          expect(response.headers['content-type']).toContain(route.ownerType);
        }
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each(OWNER_ROUTES)(
      'answers another user 404 on $label, exactly as for a record that does not exist',
      async (route) => {
        const before = await snapshot();

        const foreign = await ownerCall(route, 'otherUser');
        const absent = await ownerCall(route, 'otherUser', missing());

        expect(foreign.status).toBe(404);
        expect(withoutRequestFields(foreign.body)).toEqual({
          statusCode: 404,
          error: 'Not Found',
          message: route.notFound,
        });
        expect(absent.status).toBe(404);
        expect(withoutRequestFields(absent.body)).toEqual(
          withoutRequestFields(foreign.body),
        );
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each(OWNER_ROUTES)(
      'answers every staff role 403 on $label: owner routes are for registered users only',
      async (route) => {
        const before = await snapshot();

        for (const label of STAFF) {
          const response = await ownerCall(route, label);
          expect({ label, status: response.status }).toEqual({
            label,
            status: 403,
          });
          expect(response.body.message).toBe(ROLE_REFUSED_MESSAGE);
        }
        expect(await snapshot()).toEqual(before);
      },
      MANY_REQUESTS_TIMEOUT,
    );

    it.each(OWNER_ROUTES)('answers a guest 401 on $label', async (route) => {
      const response = await ownerCall(route, null);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('lists of my bookings', () => {
    const ids = (body: { items: { id: string }[] }) =>
      body.items.map((item) => item.id);

    it("shows the owner's flight bookings and hotel reservations to the owner", async () => {
      const flights = await send('GET', '/api/flight-bookings', 'owner');
      const stays = await send('GET', '/api/hotel-bookings', 'owner');

      expect(flights.status).toBe(200);
      expect(ids(flights.body)).toContain(own.flightBooking);
      expect(stays.status).toBe(200);
      expect(ids(stays.body)).toEqual(
        expect.arrayContaining([own.hotelBooking, own.upcomingHotelBooking]),
      );
    });

    it.each(LIST_ROUTES)(
      'shows another user none of them on %s',
      async (label) => {
        const path = label.split(' ')[1];

        const response = await send('GET', path, 'otherUser');

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([]);
        expect(response.body.meta.total).toBe(0);
      },
    );

    it.each(LIST_ROUTES)(
      'refuses every staff role on %s, and a guest',
      async (label) => {
        const path = label.split(' ')[1];

        for (const staff of STAFF) {
          const response = await send('GET', path, staff);
          expect({ staff, status: response.status }).toEqual({
            staff,
            status: 403,
          });
          expect(response.body.message).toBe(ROLE_REFUSED_MESSAGE);
        }
        expect((await send('GET', path, null)).status).toBe(401);
      },
      MANY_REQUESTS_TIMEOUT,
    );
  });

  describe('the owner comes from the login', () => {
    const ownerIdRefused = (body: {
      errors?: { field: string; messages: string[] }[];
    }) =>
      expect(body.errors).toEqual(
        expect.arrayContaining([
          { field: 'userId', messages: ['property userId should not exist'] },
        ]),
      );

    it.each(LIST_ROUTES)(
      "refuses an owner id in the query of %s, so nobody can ask for someone else's list",
      async (label) => {
        const path = label.split(' ')[1];

        const response = await send(
          'GET',
          `${path}?userId=${fx.user.id}`,
          'otherUser',
        );

        expect(response.status).toBe(400);
        ownerIdRefused(response.body);
      },
    );

    it.each([...CREATE_ROUTES, 'POST /api/payments'])(
      'refuses an owner id in the body of %s',
      async (label) => {
        const path = label.split(' ')[1];

        const response = await send('POST', path, 'otherUser', {
          userId: fx.user.id,
        });

        expect(response.status).toBe(400);
        ownerIdRefused(response.body);
      },
    );
  });

  describe('admins and moderators', () => {
    const everyoneElse = (route: ProviderRoute): ActorLabel[] =>
      (['owner', 'otherUser', ...STAFF] as ActorLabel[]).filter(
        (label) => label !== route.allowed && label !== route.foreign?.actor,
      );

    it.each(PROVIDER_ROUTES.filter((route) => route.sendAllowed))(
      'serves $allowed on $label, with the owner’s booking in it',
      async (route) => {
        const response = await send(
          route.verb,
          route.path(),
          route.allowed,
          route.body?.(),
        );

        expect(response.status).toBe(200);
        const text = response.text;
        for (const shown of route.shows?.() ?? []) {
          expect(text).toContain(shown);
        }
      },
    );

    it.each(PROVIDER_ROUTES.filter((route) => route.foreign))(
      'answers 403 to $foreign.actor, the moderator of another provider, on $label',
      async (route) => {
        const before = await snapshot();
        const foreign = route.foreign as { actor: StaffLabel; message: string };

        const response = await send(
          route.verb,
          route.path(),
          foreign.actor,
          route.body?.(),
        );

        expect(response.status).toBe(403);
        expect(response.body.message).toBe(foreign.message);
        await route.unchanged?.();
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each(PROVIDER_ROUTES)(
      'answers 403 to every other role on $label, the owner included, and 401 to a guest',
      async (route) => {
        const before = await snapshot();

        for (const label of everyoneElse(route)) {
          const response = await send(
            route.verb,
            route.path(),
            label,
            route.body?.(),
          );
          expect({ label, status: response.status }).toEqual({
            label,
            status: 403,
          });
          expect(response.body.message).toBe(ROLE_REFUSED_MESSAGE);
          await route.unchanged?.();
        }
        const guest = await send(
          route.verb,
          route.path(),
          null,
          route.body?.(),
        );
        expect(guest.status).toBe(401);
        expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
        await route.unchanged?.();
        expect(await snapshot()).toEqual(before);
      },
      MANY_REQUESTS_TIMEOUT,
    );
  });

  describe('completeness', () => {
    /** Every route of the running app, as `METHOD /api/path`. */
    const appRoutes = (): { label: string; isPublic: boolean }[] => {
      const reflector = fx.app.get(Reflector);
      const found: { label: string; isPublic: boolean }[] = [];
      for (const wrapper of fx.app.get(DiscoveryService).getControllers()) {
        const { instance, metatype } = wrapper;
        if (!instance || typeof metatype !== 'function') continue;
        const prototype = Object.getPrototypeOf(instance) as object;
        const controllerPaths = asList(
          reflector.get<string | string[] | undefined>(PATH_KEY, metatype),
        );
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler: unknown = Object.getOwnPropertyDescriptor(
            prototype,
            name,
          )?.value;
          if (typeof handler !== 'function') continue;
          const methodId = reflector.get<RequestMethod | undefined>(
            METHOD_KEY,
            handler,
          );
          if (methodId === undefined) continue;
          const isPublic =
            reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
              handler,
              metatype,
            ]) === true;
          for (const controllerPath of controllerPaths) {
            for (const methodPath of asList(
              reflector.get<string | string[] | undefined>(PATH_KEY, handler),
            )) {
              found.push({
                label: `${RequestMethod[methodId]} ${joinPath('api', controllerPath, methodPath)}`,
                isPublic,
              });
            }
          }
        }
      }
      return found;
    };

    const isBookingRoute = (label: string): boolean => {
      const path = label.split(' ')[1];
      return (
        BOOKING_AREAS.some(
          (area) => path === area || path.startsWith(`${area}/`),
        ) || BOOKING_WORDS.test(path)
      );
    };

    it('finds the routes of the app, so the check below cannot pass on an empty list', () => {
      const labels = appRoutes().map((route) => route.label);

      expect(labels.length).toBeGreaterThan(50);
      expect(labels).toContain('GET /api/flight-bookings/:id');
    });

    it('covers every booking-family route of the app, so a new one must be added here', () => {
      const covered = new Set<string>([
        ...OWNER_ROUTES.map((route) => route.label),
        ...LIST_ROUTES,
        ...CREATE_ROUTES,
        ...PROVIDER_ROUTES.map((route) => route.label),
        ...PUBLIC_ROUTES,
      ]);
      const bookingRoutes = appRoutes()
        .map((route) => route.label)
        .filter(isBookingRoute)
        // Itinerary routes are owner-only too; owner-access.e2e-spec.ts covers them.
        .filter((label) => !label.split(' ')[1].startsWith('/api/itineraries'));

      expect([...new Set(bookingRoutes)].sort()).toEqual([...covered].sort());
    });

    it('keeps public only the webhook and the reviews of a hotel', () => {
      const publicBookingRoutes = appRoutes()
        .filter((route) => route.isPublic && isBookingRoute(route.label))
        .map((route) => route.label)
        .sort();

      expect(publicBookingRoutes).toEqual([...PUBLIC_ROUTES].sort());
    });

    it('never called Stripe', () => {
      for (const spy of stripeCalls) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });
});
