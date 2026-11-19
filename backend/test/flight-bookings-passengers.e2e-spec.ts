import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';
import { sessionCookieFor } from './support/session-cookie';

interface PassengerBody {
  fullName: string;
  dateOfBirth: string;
  type: string;
  passportNumber: string;
  extraBags: { bags: number; weightKg: number } | null;
}

interface BookingBody {
  id: string;
  fareTotal: number;
  baggageTotal: number;
  total: number;
  segments: { seatsReserved: number }[];
  passengerCounts: { adults: number; children: number; infants: number };
  passengers: PassengerBody[];
}

/** The airline's extra-bag rule for the tests that sell bags (FLT-08). */
const SELLS_BAGS = {
  cancellationTiers: [],
  extraBagPrice: 4500,
  maxExtraBags: 2,
};

describe('Passenger details and extra baggage (e2e, FLT-19)', () => {
  let fx: FlightFixture;
  let bookings: Model<FlightBooking>;
  let users: Model<User>;
  /** A second registered user, for the ownership check. */
  let stranger: Actor;
  const bookingIds = new Set<string>();

  let serial = 0;
  const passenger = (
    dateOfBirth = '1990-01-01',
    fields: Record<string, unknown> = {},
  ) => ({
    fullName: 'Passenger Test Person',
    dateOfBirth,
    passportNumber: `FLT19${String((serial += 1)).padStart(6, '0')}`,
    ...fields,
  });

  /** Sends a hold and records the booking it made, if any. */
  const hold = async (body: Record<string, unknown>, actor?: Actor) => {
    const call = fx.http().post('/api/flight-bookings/hold');
    const response = await (
      actor ? call.set('Cookie', actor.cookie) : call
    ).send(body);
    if (response.status === 201) {
      bookingIds.add((response.body as BookingBody).id);
    }
    return response;
  };

  /** A flight with one economy cabin (23 kg per bag) and its local departure date. */
  const flight = async (price = 10005) => {
    const flightId = await fx.insertFlight({
      cabins: [fx.storedCabin({ price, maxBagKg: 23, freeBags: 1 })],
    });
    const stored = await fx.flights.findById(flightId).lean().orFail().exec();
    return { flightId, departure: stored.departureDateLocal };
  };

  const heldSeatsOf = async (flightId: string) => {
    const stored = await fx.flights.findById(flightId).lean().orFail().exec();
    return stored.cabins[0].heldSeats;
  };

  const setPolicy = (policy: Record<string, unknown>) =>
    fx.airlines.findByIdAndUpdate(fx.airlineId, { $set: { policy } }).exec();

  /** `years` before `date` (`YYYY-MM-DD`), moved by `days`. */
  const yearsBefore = (date: string, years: number, days = 0): string =>
    DateTime.fromISO(date, { zone: 'utc' })
      .minus({ years })
      .plus({ days })
      .toISODate() as string;

  const fieldsOf = (body: { errors?: { field: string }[] }) =>
    (body.errors ?? []).map(({ field }) => field);

  beforeAll(async () => {
    fx = await createFlightFixture('flt19');
    bookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    users = fx.app.get<Model<User>>(getModelToken(User.name));
    const user = await users.create({
      name: `FLT-19 stranger ${fx.run}`,
      email: `flt19-stranger-${randomUUID()}@example.com`,
      passwordHash: 'not-used',
      role: Role.User,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    stranger = {
      id: user._id.toString(),
      cookie: await sessionCookieFor(fx.app, user._id.toString()),
    };
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const owner of [fx.user.id, stranger?.id]) {
        if (!owner) continue;
        const ours = await bookings
          .find({ userId: new Types.ObjectId(owner) })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of ours) bookingIds.add(_id.toString());
      }
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
      if (stranger) {
        await deleteSessionsOf(fx.app, stranger.id);
        await users.findByIdAndDelete(stranger.id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  afterEach(async () => {
    await setPolicy({ cancellationTiers: [] });
  });

  it('derives each type on the departure date and prices the infant at 10%', async () => {
    const { flightId, departure } = await flight(10005);

    const response = await hold(
      {
        flightId,
        cabin: CabinClass.Economy,
        passengers: [
          // Exactly 12 on the departure date: an adult.
          passenger(yearsBefore(departure, 12), { passportNumber: 'ab12cd34' }),
          // 12 the day after: still a child.
          passenger(yearsBefore(departure, 12, 1)),
          // Exactly 2 on the departure date: a child.
          passenger(yearsBefore(departure, 2)),
          // 2 the day after: an infant.
          passenger(yearsBefore(departure, 2, 1)),
        ],
      },
      fx.user,
    );

    expect(response.status).toBe(201);
    const body = response.body as BookingBody;
    expect(body.passengers.map(({ type }) => type)).toEqual([
      'adult',
      'child',
      'child',
      'infant',
    ]);
    expect(body.passengerCounts).toEqual({
      adults: 1,
      children: 2,
      infants: 1,
    });
    expect(body.segments[0].seatsReserved).toBe(3);
    // 3 seats at 10005 cents, the infant at round(1000.5) = 1001 cents.
    expect(body.fareTotal).toBe(3 * 10005 + 1001);
    expect(body.baggageTotal).toBe(0);
    expect(body.total).toBe(body.fareTotal);
    expect(body.passengers[0]).toEqual({
      fullName: 'Passenger Test Person',
      dateOfBirth: yearsBefore(departure, 12),
      type: 'adult',
      passportNumber: 'AB12CD34',
      extraBags: null,
      // FLT-12: a one-way booking has no return bags.
      returnExtraBags: null,
    });
    expect(await heldSeatsOf(flightId)).toBe(3);

    const stored = await bookings.findById(body.id).lean().orFail().exec();
    expect(typeof stored.passengers[0].dateOfBirth).toBe('string');
    expect(stored.passengers[0].passportNumber).toBe('AB12CD34');
  });

  it("adds the extra bag fees, bags × the airline's price, to the total", async () => {
    await setPolicy(SELLS_BAGS);
    const { flightId } = await flight(20000);

    const response = await hold(
      {
        flightId,
        cabin: CabinClass.Economy,
        passengers: [
          passenger('1990-01-01', { extraBags: { bags: 2, weightKg: 46 } }),
          passenger('1991-01-01', { extraBags: { bags: 1, weightKg: 10 } }),
          passenger('1992-01-01'),
        ],
      },
      fx.user,
    );

    expect(response.status).toBe(201);
    const body = response.body as BookingBody;
    expect(body.fareTotal).toBe(3 * 20000);
    expect(body.baggageTotal).toBe(3 * 4500);
    expect(body.total).toBe(3 * 20000 + 3 * 4500);
    expect(body.passengers.map(({ extraBags }) => extraBags)).toEqual([
      { bags: 2, weightKg: 46 },
      { bags: 1, weightKg: 10 },
      null,
    ]);

    const stored = await bookings.findById(body.id).lean().orFail().exec();
    expect(stored.baggageTotal).toBe(13500);
    expect(stored.segments[0].extraBagPrice).toBe(4500);
    expect(stored.passengers[0].baggage).toEqual([
      { segment: 0, bags: 2, weightKg: 46 },
    ]);
  });

  describe('answers 400 and holds nothing', () => {
    it.each([
      [
        'extra bags from an airline that sells none',
        { cancellationTiers: [] },
        { bags: 1, weightKg: 5 },
        'passengers.1.extraBags',
      ],
      [
        "more bags than the airline's maximum",
        SELLS_BAGS,
        { bags: 3, weightKg: 5 },
        'passengers.1.extraBags.bags',
      ],
      [
        "a weight above bags × the cabin's maxBagKg",
        SELLS_BAGS,
        { bags: 2, weightKg: 47 },
        'passengers.1.extraBags.weightKg',
      ],
    ])('for %s', async (_label, policy, extraBags, field) => {
      await setPolicy(policy);
      const { flightId } = await flight();

      const response = await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [passenger(), passenger('1985-01-01', { extraBags })],
        },
        fx.user,
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(fieldsOf(response.body)).toEqual([field]);
      expect(await heldSeatsOf(flightId)).toBe(0);
    });

    it('for the same passport number twice, in any letter case', async () => {
      const { flightId } = await flight();

      const response = await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [
            passenger('1990-01-01', { passportNumber: 'dup12345' }),
            passenger('1991-01-01', { passportNumber: 'DUP12345' }),
          ],
        },
        fx.user,
      );

      expect(response.status).toBe(400);
      expect(fieldsOf(response.body)).toEqual(['passengers.1.passportNumber']);
      expect(await heldSeatsOf(flightId)).toBe(0);
    });

    it('for a bad date of birth, without repeating it', async () => {
      const { flightId } = await flight();

      const response = await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [passenger(), passenger('2031-02-30')],
        },
        fx.user,
      );

      expect(response.status).toBe(400);
      expect(fieldsOf(response.body)).toEqual(['passengers.1.dateOfBirth']);
      expect(JSON.stringify(response.body)).not.toContain('2031-02-30');
      expect(await heldSeatsOf(flightId)).toBe(0);
    });

    it('for a booking with only an infant and a child', async () => {
      const { flightId, departure } = await flight();

      const response = await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [
            passenger(yearsBefore(departure, 5)),
            passenger(yearsBefore(departure, 1)),
          ],
        },
        fx.user,
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'passengers',
          messages: [
            'A booking needs at least one adult (12 or older on the departure date)',
          ],
        },
        {
          field: 'passengers',
          messages: [
            'A booking cannot have more infants (younger than 2 on the departure date) than adults',
          ],
        },
      ]);
      expect(await heldSeatsOf(flightId)).toBe(0);
    });
  });

  describe('who may book and see it', () => {
    it('answers 401 to a guest and 403 to an administrator and a moderator', async () => {
      const { flightId } = await flight();
      const body = {
        flightId,
        cabin: CabinClass.Economy,
        passengers: [passenger()],
      };

      expect((await hold(body)).status).toBe(401);
      expect((await hold(body, fx.admin)).status).toBe(403);
      expect((await hold(body, fx.moderator)).status).toBe(403);
      expect(await heldSeatsOf(flightId)).toBe(0);
    });

    it('keeps the booking to its owner: another user gets 404 for it', async () => {
      const { flightId } = await flight();
      const response = await hold(
        { flightId, cabin: CabinClass.Economy, passengers: [passenger()] },
        fx.user,
      );
      expect(response.status).toBe(201);
      const id = (response.body as BookingBody).id;

      const own = await fx
        .http()
        .get(`/api/bookings/flight/${id}/policies`)
        .set('Cookie', fx.user.cookie);
      const other = await fx
        .http()
        .get(`/api/bookings/flight/${id}/policies`)
        .set('Cookie', stranger.cookie);

      expect(own.status).toBe(200);
      expect(other.status).toBe(404);
      expect(JSON.stringify(other.body)).not.toContain('Passenger Test');
      const stored = await bookings.findById(id).lean().orFail().exec();
      expect(stored.userId.toString()).toBe(fx.user.id);
    });
  });

  it('never writes a passport number, a date of birth or a name to the logs', async () => {
    await setPolicy(SELLS_BAGS);
    const { flightId } = await flight();
    const secret = {
      fullName: 'Logcheck Secretname',
      dateOfBirth: '1977-07-07',
      passportNumber: 'LOGCHECK777',
    };
    const written: string[] = [];
    // Records every write instead of printing it; restored in finally.
    const record = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    const out = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(record as never);
    const err = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(record as never);
    try {
      // A success, a refused passenger and a refused bag.
      await hold(
        { flightId, cabin: CabinClass.Economy, passengers: [secret] },
        fx.user,
      );
      await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [{ ...secret, dateOfBirth: '2999-01-01' }],
        },
        fx.user,
      );
      await hold(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [{ ...secret, extraBags: { bags: 9, weightKg: 5 } }],
        },
        fx.user,
      );
    } finally {
      out.mockRestore();
      err.mockRestore();
    }

    const logs = written.join('');
    for (const value of Object.values(secret)) {
      expect(logs).not.toContain(value);
    }
  });
});
