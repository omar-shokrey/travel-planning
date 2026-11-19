import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { SUMMARY_PRICE_NOTE } from './../src/flight-bookings/dto/flight-booking-summary-response.dto';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  type Actor,
  createFlightFixture,
  FIXTURE_ZONES,
  type FlightFixture,
} from './support/flight-fixture';

interface SummaryBody {
  flight: {
    id: string;
    departureLocal: string;
    departureTimeZone: string;
    arrivalTimeZone: string;
  };
  airline: { id: string; name: string; code: string };
  cabin: string;
  seats: number;
  passengerCounts: { adults: number; children: number; infants: number };
  passengers: {
    fullName: string;
    dateOfBirth: string;
    type: string;
    passportNumber: string;
    fare: number;
    extraBags: { bags: number; weightKg: number } | null;
    baggageFee: number;
  }[];
  baggage: {
    freeBags: number;
    maxBagKg: number;
    extraBagPrice: number | null;
    maxExtraBags: number;
  };
  currency: string;
  fareTotal: number;
  baggageTotal: number;
  total: number;
  priceNote: string;
}

/** The airline's extra-bag rule and tiers (FLT-08, FLT-09). */
const POLICY = {
  cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  extraBagPrice: 4500,
  maxExtraBags: 2,
};

const PRICE = 10005;

describe('Booking summary (e2e, FLT-21)', () => {
  let fx: FlightFixture;
  let bookings: Model<FlightBooking>;
  /** Bookings the one hold of this suite made, deleted one by one by id. */
  const bookingIds = new Set<string>();

  let serial = 0;
  const passenger = (
    dateOfBirth = '1990-01-01',
    fields: Record<string, unknown> = {},
  ) => ({
    fullName: 'Summary Test Person',
    dateOfBirth,
    passportNumber: `FLT21${String((serial += 1)).padStart(6, '0')}`,
    ...fields,
  });

  /** `years` before `date` (`YYYY-MM-DD`). */
  const yearsBefore = (date: string, years: number): string =>
    DateTime.fromISO(date, { zone: 'utc' })
      .minus({ years })
      .toISODate() as string;

  const summarise = (body: Record<string, unknown>, actor?: Actor) => {
    const call = fx.http().post('/api/flight-bookings');
    return (actor ? call.set('Cookie', actor.cookie) : call).send(body);
  };

  /** A flight with one economy cabin; returns its id and local departure date. */
  const flight = async (
    cabin: Parameters<FlightFixture['storedCabin']>[0] = {},
    options: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) => {
    const flightId = await fx.insertFlight({
      ...options,
      cabins: [
        fx.storedCabin({ price: PRICE, freeBags: 1, maxBagKg: 23, ...cabin }),
      ],
    });
    const stored = await fx.flights.findById(flightId).lean().orFail().exec();
    return { flightId, departure: stored.departureDateLocal };
  };

  const heldSeatsOf = async (flightId: string) =>
    (await fx.flights.findById(flightId).lean().orFail().exec()).cabins[0]
      .heldSeats;

  /** The user's bookings of this flight: a narrow filter, read only. */
  const bookingsOf = (flightId: string) =>
    bookings
      .countDocuments({
        userId: new Types.ObjectId(fx.user.id),
        'segments.flightId': new Types.ObjectId(flightId),
      })
      .exec();

  /** 2 adults (one with 2 extra bags), 1 child and 1 infant on that date. */
  const family = (flightId: string, departure: string) => ({
    flightId,
    cabin: CabinClass.Economy,
    passengers: [
      passenger('1985-03-02', { extraBags: { bags: 2, weightKg: 40 } }),
      passenger('1987-11-20'),
      passenger(yearsBefore(departure, 6)),
      passenger(yearsBefore(departure, 1)),
    ],
  });

  beforeAll(async () => {
    fx = await createFlightFixture('flt21');
    bookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    await fx.airlines
      .findByIdAndUpdate(fx.airlineId, { $set: { policy: POLICY } })
      .exec();
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    if (!fx) return;
    try {
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
    } finally {
      // Deletes the flights (with any seats the hold took), the airline and users.
      await fx.cleanup();
    }
  });

  it('shows the flight, the airline, every passenger and the exact totals', async () => {
    const { flightId, departure } = await flight();

    const response = await summarise(family(flightId, departure), fx.user);

    expect(response.status).toBe(200);
    const body = response.body as SummaryBody;
    expect(body.flight.id).toBe(flightId);
    expect(body.flight.departureTimeZone).toBe(FIXTURE_ZONES.departure);
    expect(body.flight.arrivalTimeZone).toBe(FIXTURE_ZONES.arrival);
    expect(body.flight.departureLocal).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
    expect(body.airline).toMatchObject({ id: fx.airlineId });
    expect(body.airline.name).toContain(fx.run);
    expect(body.airline.code).toMatch(/^F/);
    expect(body).toMatchObject({
      cabin: 'economy',
      seats: 3,
      passengerCounts: { adults: 2, children: 1, infants: 1 },
      baggage: {
        freeBags: 1,
        maxBagKg: 23,
        extraBagPrice: 4500,
        maxExtraBags: 2,
      },
      currency: 'USD',
      // 3 seats at 10005 cents and the infant at round(1000.5) = 1001 cents.
      fareTotal: 3 * PRICE + 1001,
      // 2 extra bags × 4500 cents.
      baggageTotal: 9000,
      total: 3 * PRICE + 1001 + 9000,
      priceNote: SUMMARY_PRICE_NOTE,
    });
    expect(
      body.passengers.map(({ type, fare, baggageFee, extraBags }) => ({
        type,
        fare,
        baggageFee,
        extraBags,
      })),
    ).toEqual([
      {
        type: 'adult',
        fare: PRICE,
        baggageFee: 9000,
        extraBags: { bags: 2, weightKg: 40 },
      },
      { type: 'adult', fare: PRICE, baggageFee: 0, extraBags: null },
      { type: 'child', fare: PRICE, baggageFee: 0, extraBags: null },
      { type: 'infant', fare: 1001, baggageFee: 0, extraBags: null },
    ]);
    for (const key of ['id', 'status', 'holdExpiresAt', 'reference']) {
      expect(body).not.toHaveProperty(key);
    }

    // Nothing was held and nothing was saved.
    expect(await heldSeatsOf(flightId)).toBe(0);
    expect(await bookingsOf(flightId)).toBe(0);
  });

  it('gives the same totals as the hold for the same body', async () => {
    const { flightId, departure } = await flight();
    const body = family(flightId, departure);

    const summary = await summarise(body, fx.user);
    const held = await fx
      .http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', fx.user.cookie)
      .send(body);

    expect([summary.status, held.status]).toEqual([200, 201]);
    bookingIds.add((held.body as { id: string }).id);
    const pick = ({ fareTotal, baggageTotal, total }: SummaryBody) => ({
      fareTotal,
      baggageTotal,
      total,
    });
    expect(pick(held.body as SummaryBody)).toEqual(
      pick(summary.body as SummaryBody),
    );
  });

  it('answers 409 when the cabin has too few seats left, and holds nothing', async () => {
    // 5 seats, 2 booked, 2 held: 1 left for 3 seats.
    const { flightId, departure } = await flight({
      totalSeats: 5,
      bookedSeats: 2,
      heldSeats: 2,
    });

    const response = await summarise(family(flightId, departure), fx.user);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Not enough seats left in this cabin');
    expect(await heldSeatsOf(flightId)).toBe(2);
  });

  describe('the same refusals as the hold', () => {
    it.each([
      ['cancelled', { status: FlightStatus.Cancelled }],
      [
        'whose departure time has passed',
        { departureAt: new Date(Date.now() - 3_600_000) },
      ],
    ])('answers 409 for a flight %s', async (_label, options) => {
      const { flightId } = await flight({}, options);

      const response = await summarise(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [passenger()],
        },
        fx.user,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('This flight can no longer be booked');
    });

    it('answers 404 for an unknown flight and for a missing cabin', async () => {
      const { flightId } = await flight();

      const unknown = await summarise(
        {
          flightId: new Types.ObjectId().toString(),
          cabin: CabinClass.Economy,
          passengers: [passenger()],
        },
        fx.user,
      );
      const noCabin = await summarise(
        { flightId, cabin: CabinClass.Business, passengers: [passenger()] },
        fx.user,
      );

      expect(unknown.status).toBe(404);
      expect(unknown.body.message).toBe('Flight not found');
      expect(noCabin.status).toBe(404);
      expect(noCabin.body.message).toBe('This flight has no business cabin');
    });

    it('answers 404 for a flight of a deactivated airline', async () => {
      const { flightId } = await flight();
      await fx.airlines
        .findByIdAndUpdate(fx.airlineId, { $set: { active: false } })
        .exec();
      try {
        const response = await summarise(
          {
            flightId,
            cabin: CabinClass.Economy,
            passengers: [passenger()],
          },
          fx.user,
        );

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Flight not found');
      } finally {
        await fx.airlines
          .findByIdAndUpdate(fx.airlineId, { $set: { active: true } })
          .exec();
      }
    });

    it('answers 400 on the field paths, and holds nothing', async () => {
      const { flightId, departure } = await flight();
      const base = { flightId, cabin: CabinClass.Economy };
      const cases: [Record<string, unknown>, string][] = [
        // Only a child: no adult.
        [
          { ...base, passengers: [passenger(yearsBefore(departure, 6))] },
          'passengers',
        ],
        // One adult, two infants.
        [
          {
            ...base,
            passengers: [
              passenger(),
              passenger(yearsBefore(departure, 1)),
              passenger(yearsBefore(departure, 1)),
            ],
          },
          'passengers',
        ],
        // 3 extra bags where the airline allows 2.
        [
          {
            ...base,
            passengers: [
              passenger('1990-01-01', { extraBags: { bags: 3, weightKg: 30 } }),
            ],
          },
          'passengers.0.extraBags.bags',
        ],
        [
          {
            ...base,
            passengers: [passenger('1990-01-01', { type: 'infant' })],
          },
          'passengers.0.type',
        ],
        [{ ...base, passengers: [passenger()], price: 1 }, 'price'],
      ];

      for (const [body, field] of cases) {
        const response = await summarise(body, fx.user);

        expect(response.status).toBe(400);
        expect(
          (response.body.errors as { field: string }[]).map((e) => e.field),
        ).toContain(field);
      }
      expect(await heldSeatsOf(flightId)).toBe(0);
    });
  });

  it('answers 401 to a guest and 403 to an administrator and a moderator', async () => {
    const { flightId } = await flight();
    const body = {
      flightId,
      cabin: CabinClass.Economy,
      passengers: [passenger()],
    };

    const guest = await summarise(body);
    const admin = await summarise(body, fx.admin);
    const moderator = await summarise(body, fx.moderator);

    expect(guest.status).toBe(401);
    expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    expect([admin.status, moderator.status]).toEqual([403, 403]);
  });

  it('never writes a passport number, a date of birth or a name to the logs', async () => {
    const { flightId } = await flight();
    const secret = {
      fullName: 'Summarylog Secretname',
      dateOfBirth: '1976-06-06',
      passportNumber: 'SUMLOG666',
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
      await summarise(
        { flightId, cabin: CabinClass.Economy, passengers: [secret] },
        fx.user,
      );
      await summarise(
        {
          flightId,
          cabin: CabinClass.Economy,
          passengers: [{ ...secret, dateOfBirth: '2999-01-01' }],
        },
        fx.user,
      );
      await summarise(
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

  it('documents POST /api/flight-bookings in Swagger', async () => {
    const document = (await fx.http().get('/api/docs-json').expect(200)).body;
    const operation = document.paths['/api/flight-bookings'].post as {
      summary: string;
      tags: string[];
      security: Record<string, unknown>[];
      requestBody: { content: Record<string, { schema: { $ref: string } }> };
      responses: Record<
        string,
        { content?: Record<string, { schema: { $ref: string } }> }
      >;
    };

    expect(operation.summary).toBe(
      'Show the booking summary before payment (FLT-21)',
    );
    expect(operation.tags).toEqual(['Flight bookings']);
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
      '#/components/schemas/HoldFlightBookingDto',
    );
    expect(
      operation.responses['200'].content?.['application/json'].schema.$ref,
    ).toBe('#/components/schemas/FlightBookingSummaryResponseDto');
  });
});
