import './support/auth-env';
import { randomUUID } from 'node:crypto';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { type Connection, type Model, Types } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { Role } from './../src/common/enums/role.enum';
import {
  AIRPORTS_LOCKED_MESSAGE,
  DUPLICATE_FLIGHT_MESSAGE,
  EMPTY_FLIGHT_UPDATE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import type { Flight } from './../src/flights/models/flight.schema';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  type Actor,
  createFlightFixture,
  FIXTURE_ZONES,
  type FlightFixture,
} from './support/flight-fixture';
import { sessionCookieFor } from './support/session-cookie';

interface FieldError {
  field: string;
  messages: string[];
}

interface SwaggerProperty {
  description?: string;
  example?: unknown;
}

type BookingStatus =
  'pending_payment' | 'confirmed' | 'completed' | 'expired' | 'cancelled';

const HOUR_MS = 3_600_000;
const LOCAL = "yyyy-MM-dd'T'HH:mm";
const CAIRO = FIXTURE_ZONES.departure;
const NEW_YORK = FIXTURE_ZONES.arrival;

/** A moment as the clocks show it in a zone, as a moderator types it. */
const localIn = (instant: Date, zone: string): string =>
  DateTime.fromJSDate(instant, { zone }).toFormat(LOCAL);

/** The calendar date of a moment in a zone. */
const dateIn = (instant: Date, zone: string): string =>
  DateTime.fromJSDate(instant, { zone }).toFormat('yyyy-MM-dd');

let base: Date | undefined;

/**
 * 09:00 UTC, 40 days ahead: the same calendar day in Cairo and in New York.
 * Fixed at its first use, so a run across midnight UTC keeps one base.
 */
const baseDeparture = (): Date => {
  base ??= DateTime.utc()
    .plus({ days: 40 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
  return new Date(base);
};

describe('Flight edit (e2e, FLT-05)', () => {
  let fx: FlightFixture;
  let users: Model<User>;
  let notifications: Model<Notification>;
  let connection: Connection;
  /** Accounts this suite makes besides the fixture's, deleted by id. */
  const passengerIds: string[] = [];
  /** Bookings this suite inserts in flight_bookings, deleted by id. */
  const bookingIds: Types.ObjectId[] = [];

  const bookings = () => connection.collection('flight_bookings');

  const patch = (flightId: string, body: unknown, actor?: Actor) => {
    const call = fx.http().patch(`/api/flights/${flightId}`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  const stored = (flightId: string) =>
    fx.flights.findById(flightId).lean<Flight>().exec();

  /** A scheduled flight of the moderator's airline, CAI to NYC airports of the fixture, with one cabin. */
  const insertFlight = (
    options: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) => {
    const departureAt = options.departureAt ?? baseDeparture();
    return fx.insertFlight({
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 12 * HOUR_MS),
      cabins: [{}],
      ...options,
    });
  };

  /** A registered user with a live session, made by this suite. */
  const createPassenger = async (): Promise<Actor> => {
    const created = await users.create({
      name: `${fx.run} passenger`,
      email: `${fx.run}-passenger-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      consentAcceptedAt: new Date(),
    });
    const id = created._id.toString();
    passengerIds.push(id);
    return { id, cookie: await sessionCookieFor(fx.app, id) };
  };

  /** A booking of the data model's shape (specs/travel-platform.md), straight in the -test database. */
  const insertBooking = async (
    flightId: string,
    userId: string,
    status: BookingStatus,
  ): Promise<Types.ObjectId> => {
    const _id = new Types.ObjectId();
    const now = new Date();
    await bookings().insertOne({
      _id,
      reference: `${fx.run}-${_id.toString()}`,
      userId: new Types.ObjectId(userId),
      status,
      holdExpiresAt: new Date(now.getTime() + 10 * 60_000),
      currency: 'USD',
      fareTotal: 10000,
      baggageTotal: 4500,
      total: 14500,
      policyAcceptedAt: now,
      segments: [
        {
          flightId: new Types.ObjectId(flightId),
          airlineId: new Types.ObjectId(fx.airlineId),
          cabin: 'economy',
          fare: 10000,
          seatsReserved: 1,
          extraBagPrice: 4500,
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        },
      ],
      passengers: [
        {
          fullName: `${fx.run} passenger`,
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          passportNumber: 'A0000000',
          type: 'adult',
          baggage: [{ segment: 0, bags: 1, weightKg: 23 }],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    bookingIds.push(_id);
    return _id;
  };

  /** The flight_changed notifications a user got about a flight. */
  const changeNotices = (userId: string, flightId: string) =>
    notifications
      .find({
        userId: new Types.ObjectId(userId),
        type: NotificationType.FlightChanged,
        linkId: new Types.ObjectId(flightId),
      })
      .lean()
      .exec();

  beforeAll(async () => {
    fx = await createFlightFixture('flt05');
    users = fx.app.get<Model<User>>(getModelToken(User.name));
    notifications = fx.app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    connection = fx.app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    let firstError: unknown;
    const attempt = async (step: () => Promise<unknown>): Promise<void> => {
      try {
        await step();
      } catch (error) {
        firstError ??= error;
      }
    };
    if (fx) {
      for (const _id of bookingIds) {
        await attempt(() => bookings().deleteOne({ _id }));
      }
      for (const userId of [...passengerIds, fx.user.id]) {
        await attempt(async () => {
          const ours = await notifications
            .find({ userId: new Types.ObjectId(userId) })
            .select('_id')
            .lean()
            .exec();
          for (const { _id } of ours) {
            await notifications.deleteOne({ _id }).exec();
          }
        });
      }
      for (const id of passengerIds) {
        await attempt(() => deleteSessionsOf(fx.app, id));
        await attempt(() => users.deleteOne({ _id: id }).exec());
      }
      await attempt(() => fx.cleanup());
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  });

  describe('who may edit a flight: the answers of the cabin routes (FLT-04)', () => {
    const body = () => ({
      departureLocal: localIn(
        new Date(baseDeparture().getTime() + HOUR_MS),
        CAIRO,
      ),
    });

    it('answers 401 to a guest and changes nothing', async () => {
      const id = await insertFlight();
      const before = await stored(id);

      const response = await patch(id, body());

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(await stored(id)).toEqual(before);
    });

    it.each([
      ['a registered user', () => fx.user],
      ['an administrator', () => fx.admin],
      ['a hotel moderator', () => fx.hotelModerator],
    ])('answers 403 to %s (role guard)', async (_label, actor) => {
      const id = await insertFlight();
      const before = await stored(id);

      const response = await patch(id, body(), actor());

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        'You do not have permission to perform this action',
      );
      expect(await stored(id)).toEqual(before);
    });

    it('answers 403 to an airline moderator with no airline, 404 to one whose airline was deleted', async () => {
      const id = await insertFlight();

      const unassigned = await patch(id, body(), fx.unassignedModerator);
      const orphan = await patch(id, body(), fx.orphanModerator);

      expect(unassigned.status).toBe(403);
      expect(unassigned.body.message).toBe(
        'You are not assigned to an airline',
      );
      expect(orphan.status).toBe(404);
      expect(orphan.body.message).toBe('Airline not found');
    });

    it('answers 403 to the moderator of another airline, and changes nothing', async () => {
      const id = await insertFlight();
      const before = await stored(id);

      const response = await patch(id, body(), fx.otherModerator);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(FOREIGN_FLIGHT_MESSAGE);
      expect(await stored(id)).toEqual(before);
    });

    it('answers 404 for an unknown flight and 400 for a malformed id', async () => {
      const unknown = await patch(
        new Types.ObjectId().toString(),
        body(),
        fx.moderator,
      );
      const malformed = await patch('not-an-id', body(), fx.moderator);

      expect(unknown.status).toBe(404);
      expect(unknown.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
      expect(malformed.status).toBe(400);
      expect(malformed.body.message).toBe(
        'id must be a valid id (24 hexadecimal characters)',
      );
    });
  });

  describe('only a scheduled flight (FLT-30)', () => {
    it.each([
      ['a cancelled flight', { status: FlightStatus.Cancelled }],
      ['a departed flight', { status: FlightStatus.Departed }],
      [
        'a flight still stored as scheduled whose departure has passed',
        {
          departureAt: new Date(Date.now() - 2 * HOUR_MS),
          arrivalAt: new Date(Date.now() + 8 * HOUR_MS),
        },
      ],
    ])('answers 409 for %s and changes nothing', async (_label, options) => {
      const id = await insertFlight(options);
      const before = await stored(id);

      const response = await patch(
        id,
        {
          arrivalLocal: localIn(new Date(Date.now() + 20 * HOUR_MS), NEW_YORK),
        },
        fx.moderator,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
      expect(await stored(id)).toEqual(before);
    });
  });

  describe('the times, in each airport local time (FLT-03 rules)', () => {
    it('changes the departure: stored in UTC, answered in local time, the local date kept in step', async () => {
      const id = await insertFlight();
      // Two hours later, still the same day in Cairo.
      const newDeparture = new Date(baseDeparture().getTime() + 2 * HOUR_MS);

      const response = await patch(
        id,
        { departureLocal: localIn(newDeparture, CAIRO) },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id,
        departureAt: newDeparture.toISOString(),
        departureLocal: localIn(newDeparture, CAIRO),
        departureTimeZone: CAIRO,
        departureDateLocal: dateIn(newDeparture, CAIRO),
        status: 'scheduled',
      });
      expect(response.body.cabins).toHaveLength(1);
      const flight = await stored(id);
      expect(flight?.departureAt).toEqual(newDeparture);
      expect(flight?.departureDateLocal).toBe(dateIn(newDeparture, CAIRO));
    });

    it('changes the arrival alone, read in the arrival airport time zone', async () => {
      const id = await insertFlight();
      const newArrival = new Date(baseDeparture().getTime() + 14 * HOUR_MS);

      const response = await patch(
        id,
        { arrivalLocal: localIn(newArrival, NEW_YORK) },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body.arrivalAt).toBe(newArrival.toISOString());
      expect(response.body.departureAt).toBe(baseDeparture().toISOString());
    });

    it('recomputes the local departure date over midnight at an airport ahead of UTC, and the search finds the flight on its new date only (FLT-11)', async () => {
      const singapore = await fx.createAirport('Asia/Singapore', 'SG');
      // 15:00 UTC is 23:00 in Singapore (UTC+8).
      const departureAt = new Date(baseDeparture().getTime() + 6 * HOUR_MS);
      const id = await insertFlight({
        departureAirport: singapore,
        departureAt,
      });
      const oldDate = dateIn(departureAt, 'Asia/Singapore');
      // 90 minutes later: 00:30 the next day in Singapore, the same day in UTC.
      const newDeparture = new Date(departureAt.getTime() + 1.5 * HOUR_MS);
      const newDate = dateIn(newDeparture, 'Asia/Singapore');
      expect(newDate).not.toBe(oldDate);
      expect(newDeparture.toISOString().slice(0, 10)).toBe(
        departureAt.toISOString().slice(0, 10),
      );

      const response = await patch(
        id,
        { departureLocal: localIn(newDeparture, 'Asia/Singapore') },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body.departureDateLocal).toBe(newDate);
      const search = (date: string) =>
        fx
          .http()
          .get('/api/flights/search')
          .query({
            departureAirport: singapore,
            arrivalAirport: fx.airports.arrival,
            departureDate: date,
            passengers: 1,
          })
          .expect(200);
      const onNewDate = await search(newDate);
      const onOldDate = await search(oldDate);
      expect(
        onNewDate.body.items.map((item: { id: string }) => item.id),
      ).toEqual([id]);
      expect(onOldDate.body.items).toEqual([]);
    });

    it('accepts a departure and an arrival that are only in order together', async () => {
      const id = await insertFlight();
      const departure = new Date(baseDeparture().getTime() + 24 * HOUR_MS);
      const arrival = new Date(departure.getTime() + 10 * HOUR_MS);

      const response = await patch(
        id,
        {
          departureLocal: localIn(departure, CAIRO),
          arrivalLocal: localIn(arrival, NEW_YORK),
        },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        departureAt: departure.toISOString(),
        arrivalAt: arrival.toISOString(),
        departureDateLocal: dateIn(departure, CAIRO),
      });
    });

    it.each([
      [
        'an arrival not after the stored departure',
        () => ({ arrivalLocal: localIn(baseDeparture(), NEW_YORK) }),
        'arrivalLocal',
        'arrivalLocal must be after departureLocal, compared in UTC',
      ],
      [
        'a departure not before the stored arrival',
        () => ({
          departureLocal: localIn(
            new Date(baseDeparture().getTime() + 12 * HOUR_MS),
            CAIRO,
          ),
        }),
        'departureLocal',
        'departureLocal must be before the arrival, compared in UTC',
      ],
      [
        'a departure in the past',
        () => ({
          departureLocal: localIn(new Date(Date.now() - HOUR_MS), CAIRO),
        }),
        'departureLocal',
        'departureLocal must be in the future',
      ],
      [
        'an arrival inside a daylight saving gap',
        () => ({ arrivalLocal: '2028-03-12T02:30' }),
        'arrivalLocal',
        'arrivalLocal 2028-03-12T02:30 does not exist in America/New_York: the clocks skip that time (daylight saving change)',
      ],
    ])(
      'refuses %s with 400 and changes nothing',
      async (_label, body, field, message) => {
        const id = await insertFlight();
        const before = await stored(id);

        const response = await patch(id, body(), fx.moderator);

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([{ field, messages: [message] }]);
        expect(await stored(id)).toEqual(before);
      },
    );

    it('accepts the same time again: nothing changes', async () => {
      const id = await insertFlight();

      const response = await patch(
        id,
        { departureLocal: localIn(baseDeparture(), CAIRO) },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      const flight = await stored(id);
      expect(flight?.departureAt).toEqual(baseDeparture());
    });

    it('answers 409 when the new local date gives the flight the number of another flight on that date', async () => {
      const first = await insertFlight();
      const nextDay = new Date(baseDeparture().getTime() + 24 * HOUR_MS);
      const second = await insertFlight({ departureAt: nextDay });
      const number = (await stored(first))?.flightNumber;
      await fx.flights
        .updateOne({ _id: second }, { flightNumber: number })
        .exec();
      const before = await stored(second);

      const response = await patch(
        second,
        {
          departureLocal: localIn(baseDeparture(), CAIRO),
          arrivalLocal: localIn(
            new Date(baseDeparture().getTime() + 12 * HOUR_MS),
            NEW_YORK,
          ),
        },
        fx.moderator,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(DUPLICATE_FLIGHT_MESSAGE);
      expect(await stored(second)).toEqual(before);
    });
  });

  describe('the airports: locked once the flight has a booking', () => {
    let tokyo: string;
    let london: string;

    beforeAll(async () => {
      tokyo = await fx.createAirport('Asia/Tokyo', 'JP');
      london = await fx.createAirport('Europe/London', 'GB');
    });

    it('changes both airports of a flight with no booking: the instants stay, the local date is read at the new airport', async () => {
      const id = await insertFlight();

      const response = await patch(
        id,
        { departureAirport: tokyo.toLowerCase(), arrivalAirport: london },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        departureAirport: tokyo,
        arrivalAirport: london,
        departureAt: baseDeparture().toISOString(),
        departureTimeZone: 'Asia/Tokyo',
        departureLocal: localIn(baseDeparture(), 'Asia/Tokyo'),
        arrivalTimeZone: 'Europe/London',
        departureDateLocal: dateIn(baseDeparture(), 'Asia/Tokyo'),
      });
    });

    it.each([
      ['seats booked in a cabin', { bookedSeats: 2 }],
      ['seats held for a payment in a cabin', { heldSeats: 1 }],
    ])('answers 409 when the flight has %s', async (_label, counters) => {
      const id = await insertFlight({
        cabins: [{}, { cabin: CabinClass.Business, ...counters }],
      });
      const before = await stored(id);

      const response = await patch(
        id,
        { arrivalAirport: london },
        fx.moderator,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(AIRPORTS_LOCKED_MESSAGE);
      expect(await stored(id)).toEqual(before);
    });

    it.each(['pending_payment', 'confirmed'] as const)(
      'answers 409 when a %s booking holds the flight',
      async (status) => {
        const id = await insertFlight();
        await insertBooking(id, fx.user.id, status);
        const before = await stored(id);

        const response = await patch(
          id,
          { departureAirport: tokyo },
          fx.moderator,
        );

        expect(response.status).toBe(409);
        expect(response.body.message).toBe(AIRPORTS_LOCKED_MESSAGE);
        expect(await stored(id)).toEqual(before);
      },
    );

    it.each(['expired', 'cancelled', 'completed'] as const)(
      'lets the airports change when the only booking is %s: it holds no seat',
      async (status) => {
        const id = await insertFlight();
        await insertBooking(id, fx.user.id, status);

        const response = await patch(
          id,
          { departureAirport: tokyo },
          fx.moderator,
        );

        expect(response.status).toBe(200);
        expect(response.body.departureAirport).toBe(tokyo);
      },
    );

    it('accepts the airports the flight already has, and new times, on a booked flight', async () => {
      const id = await insertFlight({
        cabins: [{ bookedSeats: 30, heldSeats: 2 }],
      });
      await insertBooking(id, fx.user.id, 'confirmed');
      const newDeparture = new Date(baseDeparture().getTime() + HOUR_MS);

      const response = await patch(
        id,
        {
          departureAirport: fx.airports.departure,
          arrivalAirport: fx.airports.arrival,
          departureLocal: localIn(newDeparture, CAIRO),
        },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body.departureAt).toBe(newDeparture.toISOString());
      expect(response.body.departureAirport).toBe(fx.airports.departure);
    });

    it('refuses an airport that is not in the airports list, and the same airport twice', async () => {
      const id = await insertFlight();

      const unknown = await patch(id, { arrivalAirport: 'QQQ' }, fx.moderator);
      const same = await patch(
        id,
        { arrivalAirport: fx.airports.departure },
        fx.moderator,
      );

      expect(unknown.status).toBe(400);
      expect(unknown.body.errors).toEqual([
        {
          field: 'arrivalAirport',
          messages: ['arrivalAirport QQQ is not in the airports list'],
        },
      ]);
      expect(same.status).toBe(400);
      expect(same.body.errors).toEqual([
        {
          field: 'arrivalAirport',
          messages: ['arrivalAirport must be different from departureAirport'],
        },
      ]);
    });
  });

  describe('the notification of a time change (GEN-01)', () => {
    it('tells each user with a confirmed booking once, with the local times, and nobody else', async () => {
      const id = await insertFlight();
      const twice = await createPassenger();
      const once = await createPassenger();
      const others = {
        pending_payment: await createPassenger(),
        expired: await createPassenger(),
        cancelled: await createPassenger(),
        completed: await createPassenger(),
      };
      await insertBooking(id, twice.id, 'confirmed');
      await insertBooking(id, twice.id, 'confirmed');
      await insertBooking(id, once.id, 'confirmed');
      for (const [status, passenger] of Object.entries(others)) {
        await insertBooking(id, passenger.id, status as BookingStatus);
      }
      // A confirmed booking of another flight is not about this one.
      const otherFlight = await insertFlight();
      await insertBooking(otherFlight, fx.user.id, 'confirmed');
      const flight = await stored(id);
      const newDeparture = new Date(baseDeparture().getTime() + 2 * HOUR_MS);

      const response = await patch(
        id,
        { departureLocal: localIn(newDeparture, CAIRO) },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(await changeNotices(twice.id, id)).toHaveLength(1);
      expect(await changeNotices(once.id, id)).toHaveLength(1);
      for (const passenger of Object.values(others)) {
        expect(await changeNotices(passenger.id, id)).toEqual([]);
      }
      expect(await changeNotices(fx.user.id, id)).toEqual([]);

      const inbox = await fx
        .http()
        .get('/api/notifications')
        .set('Cookie', once.cookie)
        .expect(200);
      expect(inbox.body.items).toHaveLength(1);
      expect(inbox.body.items[0]).toMatchObject({
        type: 'flight_changed',
        linkType: 'flight',
        linkId: id,
        message: `Flight ${flight?.flightNumber} from ${fx.airports.departure} to ${fx.airports.arrival} has new times. Departure: ${localIn(newDeparture, CAIRO).replace('T', ' ')} ${fx.airports.departure} time (was ${localIn(baseDeparture(), CAIRO).replace('T', ' ')}). Arrival: ${localIn(new Date(baseDeparture().getTime() + 12 * HOUR_MS), NEW_YORK).replace('T', ' ')} ${fx.airports.arrival} time (unchanged).`,
      });
    });

    it('sends nothing when no time changed', async () => {
      const id = await insertFlight();
      const passenger = await createPassenger();
      await insertBooking(id, passenger.id, 'confirmed');

      const response = await patch(
        id,
        {
          departureLocal: localIn(baseDeparture(), CAIRO),
          arrivalAirport: fx.airports.arrival,
        },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(await changeNotices(passenger.id, id)).toEqual([]);
    });

    it('sends nothing for a change of seconds: every response shows the minute', async () => {
      const withSeconds = new Date(baseDeparture().getTime() + 45_000);
      const id = await insertFlight({ departureAt: withSeconds });
      const passenger = await createPassenger();
      await insertBooking(id, passenger.id, 'confirmed');

      const response = await patch(
        id,
        { departureLocal: localIn(withSeconds, CAIRO) },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect((await stored(id))?.departureAt).toEqual(baseDeparture());
      expect(await changeNotices(passenger.id, id)).toEqual([]);
    });

    it('sends nothing when nobody has booked, and the edit still succeeds', async () => {
      const id = await insertFlight();
      const before = await notifications
        .countDocuments({ linkId: new Types.ObjectId(id) })
        .exec();

      const response = await patch(
        id,
        {
          arrivalLocal: localIn(
            new Date(baseDeparture().getTime() + 13 * HOUR_MS),
            NEW_YORK,
          ),
        },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(before).toBe(0);
      expect(
        await notifications
          .countDocuments({ linkId: new Types.ObjectId(id) })
          .exec(),
      ).toBe(0);
    });
  });

  describe('cabin prices and seat counts: PATCH /api/flights/:id/cabins/:cabinId (FLT-04) proves the FLT-05 sentences', () => {
    const editCabin = (
      flightId: string,
      cabinId: string,
      body: unknown,
      actor = fx.moderator,
    ) =>
      fx
        .http()
        .patch(`/api/flights/${flightId}/cabins/${cabinId}`)
        .set('Cookie', actor.cookie)
        .send(body as Record<string, unknown>);

    const cabinIdOf = async (flightId: string) =>
      (await stored(flightId))?.cabins[0]._id.toString() as string;

    it('changes a price; an existing booking stays byte-for-byte the same, also after a time change', async () => {
      const id = await insertFlight({
        cabins: [{ price: 10000, bookedSeats: 1 }],
      });
      const bookingId = await insertBooking(id, fx.user.id, 'confirmed');
      const before = await bookings().findOne({ _id: bookingId });

      const price = await editCabin(id, await cabinIdOf(id), { price: 30000 });
      const time = await patch(
        id,
        {
          departureLocal: localIn(
            new Date(baseDeparture().getTime() + HOUR_MS),
            CAIRO,
          ),
        },
        fx.moderator,
      );

      expect(price.status).toBe(200);
      expect(price.body.cabins[0].price).toBe(30000);
      expect(time.status).toBe(200);
      expect(await bookings().findOne({ _id: bookingId })).toEqual(before);
    });

    it.each([
      ['booked', { bookedSeats: 10 }, 10],
      ['held', { heldSeats: 5 }, 5],
      ['booked and held', { bookedSeats: 7, heldSeats: 3 }, 10],
    ])(
      'keeps the seat count at or above the seats %s; equal is allowed',
      async (_label, counters, taken) => {
        const id = await insertFlight({ cabins: [counters] });
        const cabinId = await cabinIdOf(id);

        const below = await editCabin(id, cabinId, { totalSeats: taken - 1 });
        const equal = await editCabin(id, cabinId, { totalSeats: taken });

        expect(below.status).toBe(400);
        expect(below.body.errors).toEqual([
          {
            field: 'totalSeats',
            messages: [
              `totalSeats cannot be below the ${taken} seats already booked or held`,
            ],
          },
        ]);
        expect(equal.status).toBe(200);
        expect(equal.body.cabins[0]).toMatchObject({
          totalSeats: taken,
          availableSeats: 0,
        });
      },
    );

    it('changes only scheduled flights of the moderator airline', async () => {
      const cancelled = await insertFlight({ status: FlightStatus.Cancelled });
      const foreign = await insertFlight();

      const onCancelled = await editCabin(
        cancelled,
        await cabinIdOf(cancelled),
        {
          price: 20000,
        },
      );
      const onForeign = await editCabin(
        foreign,
        await cabinIdOf(foreign),
        { price: 20000 },
        fx.otherModerator,
      );

      expect(onCancelled.status).toBe(409);
      expect(onCancelled.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
      expect(onForeign.status).toBe(403);
      expect(onForeign.body.message).toBe(FOREIGN_FLIGHT_MESSAGE);
    });
  });

  describe('400 in the project error shape, nothing stored', () => {
    it('refuses an empty body', async () => {
      const id = await insertFlight();

      const response = await patch(id, {}, fx.moderator);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(EMPTY_FLIGHT_UPDATE_MESSAGE);
    });

    it.each([
      ['departureLocal', null, 'departureLocal must be a string'],
      ['arrivalAirport', null, 'arrivalAirport must be a string'],
      [
        'departureLocal',
        '2027-06-15T16:30:00Z',
        'departureLocal must be a local date-time YYYY-MM-DDTHH:mm (seconds optional) with no Z or offset',
      ],
      [
        'arrivalAirport',
        'JF1',
        'arrivalAirport must be a 3-letter IATA airport code',
      ],
    ])('refuses %s %p', async (field, value, message) => {
      const id = await insertFlight();
      const before = await stored(id);

      const response = await patch(id, { [field]: value }, fx.moderator);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      const errors = response.body.errors as FieldError[];
      expect(errors.map((error) => error.field)).toEqual([field]);
      expect(errors[0].messages).toContain(message);
      expect(await stored(id)).toEqual(before);
    });

    it.each([
      ['flightNumber', 'MS999'],
      ['status', 'cancelled'],
      ['airlineId', '6740f1c2a4b5c6d7e8f90123'],
      ['departureDateLocal', '2030-01-01'],
      ['departureAt', '2030-01-01T10:00:00.000Z'],
      ['cabins', []],
    ])('refuses %s, which the edit does not change', async (field, value) => {
      const id = await insertFlight();
      const before = await stored(id);

      const response = await patch(
        id,
        { arrivalAirport: fx.airports.arrival, [field]: value },
        fx.moderator,
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
      expect(await stored(id)).toEqual(before);
    });
  });

  it('documents the edit in Swagger: the lock, every answer and every field', async () => {
    const response = await fx.http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/flights/{id}'].patch as {
      tags: string[];
      security?: unknown[];
      responses: Record<string, unknown>;
      requestBody: { content: Record<string, { schema: { $ref: string } }> };
    };
    const schema = response.body.components.schemas.UpdateFlightDto as {
      properties: Record<string, SwaggerProperty>;
      required?: string[];
    };

    expect(operation.tags).toEqual(['Flights']);
    expect(operation.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/UpdateFlightDto',
    );
    expect(Object.keys(schema.properties).sort()).toEqual([
      'arrivalAirport',
      'arrivalLocal',
      'departureAirport',
      'departureLocal',
    ]);
    expect(schema.required ?? []).toEqual([]);
    for (const property of Object.values(schema.properties)) {
      expect(property.description).toEqual(expect.any(String));
      expect(property.example).toEqual(expect.any(String));
    }
  });
});
