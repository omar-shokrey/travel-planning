import './support/auth-env';
// fxrates-env runs first for every file (jest-e2e.json); only its values are read here.
import { TEST_FXRATES_API_URL } from './support/fxrates-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { PLATFORM_CURRENCY } from './../src/common/constants/currency';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { ExchangeRate } from './../src/exchange-rates/models/exchange-rate.schema';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from './../src/flight-bookings/enums/passenger-type.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { HotelBookingStatus } from './../src/hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBooking } from './../src/hotel-bookings/models/hotel-booking.schema';
import {
  BOOKING_ALREADY_LINKED_MESSAGE,
  BOOKING_NOT_LINKABLE_MESSAGE,
  ITINERARY_CHANGED_MESSAGE,
  LINKED_BOOKINGS_PER_DAY_MAX,
  LINKED_BOOKINGS_PER_DAY_MESSAGE,
} from './../src/itineraries/itineraries.constants';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

const HOUR_MS = 60 * 60 * 1000;

/**
 * A rate date no real fetch gives, different for every run, so this file
 * deletes only the rate document it made (as the ITN-18 suite does).
 */
const RATE_DATE = `2${randomInt(100, 999)}-0${randomInt(1, 10)}-1${randomInt(0, 10)}`;

/** What the fake FXRatesAPI answers: EGP 50 per dollar. */
const RATES = { USD: 1, EGP: 50 };

interface Money {
  amount: number;
  currency: string;
}
interface LinkBody {
  id: string;
  bookingType: string;
  bookingId: string;
  reference: string;
  amount: number;
  currency: string;
  converted?: Money | null;
}
interface DayBody {
  id: string;
  budgetEntries: { converted?: Money | null }[];
  linkedBookings: LinkBody[];
}
interface DetailBody {
  id: string;
  days: DayBody[];
  cityGroups: { budgetSubtotal: Money[] }[];
}
interface CategoryLine {
  category: string;
  total: Money[];
}
interface SummaryBody {
  total: Money[];
  byCategory: CategoryLine[];
  byDay: { dayId: string; total: Money[]; byCategory: CategoryLine[] }[];
}

describe('Bookings linked to itinerary days (e2e, ITN-27)', () => {
  let fixture: ItineraryFixture;
  let users: Model<User>;
  let flightBookings: Model<FlightBooking>;
  let hotelBookings: Model<HotelBooking>;
  let exchangeRates: Model<ExchangeRate>;
  let owner: FixtureUser;
  let other: FixtureUser;
  let fetchSpy: jest.SpyInstance;
  const staff: { id: string; cookie: string; role: Role }[] = [];
  const flightIds: Types.ObjectId[] = [];
  const hotelIds: Types.ObjectId[] = [];

  /** The owner's bookings and one of another user, by what each test needs. */
  const ids = {
    flightConfirmed: new Types.ObjectId(),
    hotelCompleted: new Types.ObjectId(),
    flightPending: new Types.ObjectId(),
    flightExpired: new Types.ObjectId(),
    hotelCancelled: new Types.ObjectId(),
    flightOfOther: new Types.ObjectId(),
    /** Confirmed hotel reservations for the day limit (one more than fits). */
    hotelsForTheLimit: Array.from(
      { length: LINKED_BOOKINGS_PER_DAY_MAX + 1 },
      () => new Types.ObjectId(),
    ),
  };
  const FLIGHT_TOTAL = 52000;
  const HOTEL_TOTAL = 37500;

  const http = () => fixture.http();

  const link = (
    itineraryId: string,
    body: Record<string, unknown>,
    // `null` for a guest: an explicit `undefined` would take the default.
    cookie: string | null = owner.cookie,
  ) => {
    const call = http().post(`/api/itineraries/${itineraryId}/bookings`);
    return (cookie ? call.set('Cookie', cookie) : call).send(body);
  };
  const flight = (dayId: string, bookingId = ids.flightConfirmed) => ({
    dayId,
    bookingType: 'flight',
    bookingId: bookingId.toString(),
  });
  const hotel = (dayId: string, bookingId = ids.hotelCompleted) => ({
    dayId,
    bookingType: 'hotel',
    bookingId: bookingId.toString(),
  });
  const summaryOf = async (itineraryId: string) =>
    (
      await http()
        .get(`/api/itineraries/${itineraryId}/budget-summary`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as SummaryBody;
  const line = (lines: CategoryLine[], category: string) =>
    lines.find((candidate) => candidate.category === category)?.total;
  /** Sets the owner's preferred currency (ACC-09) in the test database. */
  const prefer = (currency: string | null) =>
    users.findByIdAndUpdate(
      owner.id,
      currency === null
        ? { $unset: { preferredCurrency: 1 } }
        : { $set: { preferredCurrency: currency } },
    );

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role) => {
    const user = await users.create({
      name: `ITN-27 ${role}`,
      email: `itn27-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    staff.push({ id, role, cookie: await sessionCookieFor(fixture.app, id) });
    return staff[staff.length - 1].cookie;
  };

  /** A schema-valid flight booking of one adult on one (made-up) flight. */
  const flightBooking = (
    _id: Types.ObjectId,
    userId: string,
    status: FlightBookingStatus,
  ) => {
    flightIds.push(_id);
    return {
      _id,
      ...(status !== FlightBookingStatus.PendingPayment &&
        status !== FlightBookingStatus.Expired && {
          reference: `FB-${randomUUID()
            .replaceAll('-', '')
            .slice(0, 6)
            .toUpperCase()
            .replace(/[01ILO]/g, 'Z')}`,
        }),
      userId: new Types.ObjectId(userId),
      status,
      // A hold that ends in an hour, so the expiry job leaves it alone.
      ...(status === FlightBookingStatus.PendingPayment && {
        holdExpiresAt: new Date(Date.now() + HOUR_MS),
      }),
      currency: PLATFORM_CURRENCY,
      fareTotal: FLIGHT_TOTAL,
      baggageTotal: 0,
      total: FLIGHT_TOTAL,
      segments: [
        {
          flightId: new Types.ObjectId(),
          airlineId: new Types.ObjectId(),
          cabin: CabinClass.Economy,
          fare: FLIGHT_TOTAL,
          seatsReserved: 1,
          cancellationTiers: [],
          maxExtraBags: 0,
        },
      ],
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      passengers: [
        {
          fullName: 'ITN-27 Passenger',
          dateOfBirth: '1990-05-14',
          passportNumber: 'ITN27PASS1',
          type: PassengerType.Adult,
          baggage: [],
        },
      ],
    };
  };

  /** A schema-valid hotel reservation of one room, in 2030. */
  const hotelBooking = (
    _id: Types.ObjectId,
    userId: string,
    status: HotelBookingStatus,
  ) => {
    hotelIds.push(_id);
    return {
      _id,
      ...(status !== HotelBookingStatus.PendingPayment &&
        status !== HotelBookingStatus.Expired && {
          reference: `HB-${randomUUID()
            .replaceAll('-', '')
            .slice(0, 6)
            .toUpperCase()
            .replace(/[01ILO]/g, 'Z')}`,
        }),
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(),
      checkIn: '2030-06-10',
      checkOut: '2030-06-12',
      nights: 2,
      status,
      currency: PLATFORM_CURRENCY,
      total: HOTEL_TOTAL,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomLabel: '101 (Double)',
          pricePerNight: HOTEL_TOTAL / 2,
          adults: 2,
          childAges: [],
        },
      ],
      cancellationTiers: [],
    };
  };

  beforeAll(async () => {
    // The app calls FXRatesAPI with fetch; supertest does not use fetch.
    const realFetch = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== TEST_FXRATES_API_URL) return realFetch(input, init);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            base: 'USD',
            date: `${RATE_DATE}T23:59:00.000Z`,
            rates: RATES,
          }),
          { status: 200 },
        ),
      );
    });
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    flightBookings = fixture.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    hotelBookings = fixture.app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );
    exchangeRates = fixture.app.get<Model<ExchangeRate>>(
      getModelToken(ExchangeRate.name),
    );
    owner = await fixture.createUser();
    other = await fixture.createUser();
    await createStaff(Role.Admin);
    await createStaff(Role.HotelModerator);

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    await flightBookings.insertMany([
      flightBooking(
        ids.flightConfirmed,
        owner.id,
        FlightBookingStatus.Confirmed,
      ),
      flightBooking(
        ids.flightPending,
        owner.id,
        FlightBookingStatus.PendingPayment,
      ),
      flightBooking(ids.flightExpired, owner.id, FlightBookingStatus.Expired),
      flightBooking(ids.flightOfOther, other.id, FlightBookingStatus.Confirmed),
    ]);
    await hotelBookings.insertMany([
      hotelBooking(ids.hotelCompleted, owner.id, HotelBookingStatus.Completed),
      hotelBooking(ids.hotelCancelled, owner.id, HotelBookingStatus.Cancelled),
      ...ids.hotelsForTheLimit.map((id) =>
        hotelBooking(id, owner.id, HotelBookingStatus.Confirmed),
      ),
    ]);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    for (const id of flightIds) {
      await flightBookings.findByIdAndDelete(id);
    }
    for (const id of hotelIds) {
      await hotelBookings.findByIdAndDelete(id);
    }
    await exchangeRates.findByIdAndDelete(RATE_DATE);
    for (const { id } of staff) {
      await deleteSessionsOf(fixture.app, id);
      await users.findByIdAndDelete(id);
    }
    await fixture.cleanup();
  });

  describe('who may link, and the input', () => {
    it('answers 401 to a guest', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await link(
        itinerary.id,
        flight(itinerary.days[0].id),
        null,
      );

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('answers 403 to an administrator and to a moderator', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      for (const { cookie } of staff) {
        const response = await link(
          itinerary.id,
          flight(itinerary.days[0].id),
          cookie,
        );
        expect(response.status).toBe(403);
      }
    });

    it('answers 400 for an itinerary id that is not an id', async () => {
      const response = await link(
        'not-an-id',
        flight(new Types.ObjectId().toString()),
      );

      expect(response.status).toBe(400);
    });

    it('answers 400 naming every bad field together, and for an unknown field', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const bad = await link(itinerary.id, {
        dayId: 'day-1',
        bookingType: 'car',
        bookingId: 12,
      });
      expect(bad.status).toBe(400);
      expect(
        (bad.body.errors as { field: string }[])
          .map((error) => error.field)
          .sort(),
      ).toEqual(['bookingId', 'bookingType', 'dayId']);

      const unknown = await link(itinerary.id, {
        ...flight(itinerary.days[0].id),
        amount: 1,
      });
      expect(unknown.status).toBe(400);
    });

    it("answers 404 for a missing itinerary and 403 for another user's", async () => {
      const others = await fixture.createItinerary(other, [fixture.cityA]);

      expect(
        (
          await link(
            new Types.ObjectId().toString(),
            flight(new Types.ObjectId().toString()),
          )
        ).status,
      ).toBe(404);
      expect((await link(others.id, flight(others.days[0].id))).status).toBe(
        403,
      );
    });

    it('answers 404 "Day not found" for a day that is not on the itinerary', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await link(
        itinerary.id,
        flight(new Types.ObjectId().toString()),
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Day not found');
    });

    it('answers 404 "Booking not found" for a missing booking and for another user\'s', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const dayId = itinerary.days[0].id;

      for (const body of [
        flight(dayId, new Types.ObjectId()),
        flight(dayId, ids.flightOfOther),
        // A flight booking id sent as a hotel reservation is not found either.
        hotel(dayId, ids.flightConfirmed),
      ]) {
        const response = await link(itinerary.id, body);
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Booking not found');
      }
    });

    it.each([
      ['a pending_payment flight booking', 'flightPending', 'flight'],
      ['an expired flight booking', 'flightExpired', 'flight'],
      ['a cancelled hotel reservation', 'hotelCancelled', 'hotel'],
    ] as const)('answers 409 for %s', async (_name, key, type) => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const dayId = itinerary.days[0].id;

      const response = await link(
        itinerary.id,
        type === 'flight' ? flight(dayId, ids[key]) : hotel(dayId, ids[key]),
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(BOOKING_NOT_LINKABLE_MESSAGE);
    });
  });

  describe('a linked flight and hotel in the budget', () => {
    let itineraryId = '';
    let dayIds: string[] = [];

    beforeAll(async () => {
      const itinerary = await fixture.createItinerary(owner, [
        fixture.cityA,
        fixture.cityA,
      ]);
      itineraryId = itinerary.id;
      dayIds = itinerary.days.map((day) => day.id);
    });

    it('links a confirmed flight and a completed hotel reservation, copying reference, total and currency', async () => {
      const storedFlight = await flightBookings
        .findById(ids.flightConfirmed)
        .lean();
      const storedHotel = await hotelBookings
        .findById(ids.hotelCompleted)
        .lean();

      const first = await link(itineraryId, flight(dayIds[0]));
      expect(first.status).toBe(201);
      const second = await link(itineraryId, hotel(dayIds[1]));
      expect(second.status).toBe(201);
      const body = second.body as DetailBody;

      expect(body.days[0].linkedBookings).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          bookingType: 'flight',
          bookingId: ids.flightConfirmed.toString(),
          reference: storedFlight?.reference,
          amount: FLIGHT_TOTAL,
          currency: PLATFORM_CURRENCY,
        },
      ]);
      expect(body.days[1].linkedBookings).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          bookingType: 'hotel',
          bookingId: ids.hotelCompleted.toString(),
          reference: storedHotel?.reference,
          amount: HOTEL_TOTAL,
          currency: PLATFORM_CURRENCY,
        },
      ]);
      // Never the booking's other fields.
      expect(JSON.stringify(body)).not.toContain('ITN27PASS1');
    });

    it('leaves the bookings themselves untouched', async () => {
      const storedFlight = await flightBookings
        .findById(ids.flightConfirmed)
        .lean();
      const storedHotel = await hotelBookings
        .findById(ids.hotelCompleted)
        .lean();

      expect(storedFlight?.status).toBe(FlightBookingStatus.Confirmed);
      expect(storedFlight?.total).toBe(FLIGHT_TOTAL);
      expect(storedHotel?.status).toBe(HotelBookingStatus.Completed);
      expect(storedHotel?.total).toBe(HOTEL_TOTAL);
    });

    it('counts the flight under intercity_transport and the hotel under accommodation', async () => {
      const summary = await summaryOf(itineraryId);

      expect(line(summary.byCategory, 'intercity_transport')).toEqual([
        { amount: FLIGHT_TOTAL, currency: PLATFORM_CURRENCY },
      ]);
      expect(line(summary.byCategory, 'accommodation')).toEqual([
        { amount: HOTEL_TOTAL, currency: PLATFORM_CURRENCY },
      ]);
      expect(summary.total).toEqual([
        { amount: FLIGHT_TOTAL + HOTEL_TOTAL, currency: PLATFORM_CURRENCY },
      ]);
      expect(summary.byDay.map((day) => day.total)).toEqual([
        [{ amount: FLIGHT_TOTAL, currency: PLATFORM_CURRENCY }],
        [{ amount: HOTEL_TOTAL, currency: PLATFORM_CURRENCY }],
      ]);
    });

    it('adds both to the city-group subtotal', async () => {
      const response = await http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(
        (response.body as DetailBody).cityGroups[0].budgetSubtotal,
      ).toEqual([
        { amount: FLIGHT_TOTAL + HOTEL_TOTAL, currency: PLATFORM_CURRENCY },
      ]);
    });

    it('converts a linked booking like any other budget amount when the owner prefers another currency (ITN-18)', async () => {
      // A budget entry of the same amount and currency, converted by the same
      // rule: the link must get the same converted amount.
      await http()
        .post(`/api/itineraries/${itineraryId}/days/${dayIds[0]}/budgets`)
        .set('Cookie', owner.cookie)
        .send({
          category: 'food',
          amount: FLIGHT_TOTAL,
          currency: FIXTURE_CURRENCY,
        })
        .expect(201);
      await prefer('EGP');
      try {
        const response = await http()
          .get(`/api/itineraries/${itineraryId}`)
          .set('Cookie', owner.cookie)
          .expect(200);
        const [day] = (response.body as DetailBody).days;

        expect(day.linkedBookings[0].converted?.currency).toBe('EGP');
        expect(day.linkedBookings[0].converted).toEqual(
          day.budgetEntries[0].converted,
        );
        // The amount as copied stays as it is.
        expect(day.linkedBookings[0].amount).toBe(FLIGHT_TOTAL);
      } finally {
        await prefer(null);
      }
    });

    it('answers 409 to linking the same booking to this itinerary again, on any day', async () => {
      for (const dayId of dayIds) {
        const response = await link(itineraryId, flight(dayId));
        expect(response.status).toBe(409);
        expect(response.body.message).toBe(BOOKING_ALREADY_LINKED_MESSAGE);
      }
    });

    it('lets the same booking be linked to another itinerary of the same user', async () => {
      const another = await fixture.createItinerary(owner, [fixture.cityB]);

      expect((await link(another.id, flight(another.days[0].id))).status).toBe(
        201,
      );
    });
  });

  it(`answers 409 to the link after the ${LINKED_BOOKINGS_PER_DAY_MAX}th on one day`, async () => {
    const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
    const dayId = itinerary.days[0].id;
    const [extra, ...fitting] = ids.hotelsForTheLimit;

    for (const id of fitting) {
      expect((await link(itinerary.id, hotel(dayId, id))).status).toBe(201);
    }
    const full = await link(itinerary.id, hotel(dayId, extra));

    expect(full.status).toBe(409);
    expect(full.body.message).toBe(LINKED_BOOKINGS_PER_DAY_MESSAGE);
  });

  it('gives one 201 and one 409 to two requests that link the same booking at the same time', async () => {
    const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
    const body = flight(itinerary.days[0].id);

    const answers = await Promise.all([
      link(itinerary.id, body),
      link(itinerary.id, body),
    ]);
    const statuses = answers.map((answer) => answer.status).sort();

    expect(statuses).toEqual([201, 409]);
    const refused = answers.find((answer) => answer.status === 409);
    expect([
      BOOKING_ALREADY_LINKED_MESSAGE,
      ITINERARY_CHANGED_MESSAGE,
    ]).toContain(refused?.body.message);
    const stored = await fixture.itineraries.findById(itinerary.id).lean();
    expect(stored?.days[0].linkedBookings).toHaveLength(1);
  });

  describe('only the owner sees the links (ACC-11)', () => {
    let itineraryId = '';

    beforeAll(async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      itineraryId = itinerary.id;
      await link(itineraryId, flight(itinerary.days[0].id)).expect(201);
      await http()
        .patch(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);
    });

    it('the public view shows no link and no booking amount in its subtotals', async () => {
      const response = await http()
        .get(`/api/itineraries/public/${itineraryId}`)
        .expect(200);
      const body = response.body as DetailBody;

      expect(body.days[0].linkedBookings).toEqual([]);
      expect(body.cityGroups[0].budgetSubtotal).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(
        ids.flightConfirmed.toString(),
      );
    });

    it('a clone has no links', async () => {
      const cloned = await http()
        .post(`/api/itineraries/${itineraryId}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      const body = cloned.body as DetailBody;

      expect(body.days[0].linkedBookings).toEqual([]);
      expect(body.cityGroups[0].budgetSubtotal).toEqual([]);
      const stored = await fixture.itineraries.findById(body.id).lean();
      expect(stored?.days[0].linkedBookings).toEqual([]);
    });
  });

  it('is documented in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const route = (
      response.body as {
        paths: Record<string, Record<string, { responses: object }>>;
      }
    ).paths['/api/itineraries/{id}/bookings'];

    expect(Object.keys(route)).toEqual(['post']);
    expect(Object.keys(route.post.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );
  });
});
