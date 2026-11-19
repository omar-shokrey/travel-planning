import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { FLIGHT_NOT_FOUND_MESSAGE } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  createFlightFixture,
  FIXTURE_ZONES,
  type FlightFixture,
} from './support/flight-fixture';

interface SwaggerProperty {
  description?: string;
  example?: unknown;
}

const HOUR_MS = 3_600_000;
const LOCAL = "yyyy-MM-dd'T'HH:mm";

/** A moment as the clocks show it in a zone. */
const localIn = (instant: Date, zone: string): string =>
  DateTime.fromJSDate(instant, { zone }).toFormat(LOCAL);

describe('Flight details (e2e, FLT-17)', () => {
  let fx: FlightFixture;
  /** 09:00 UTC, 40 days ahead, fixed for the run. */
  let departureAt: Date;

  const details = (id: string, cookie?: string) => {
    const call = fx.http().get(`/api/flights/${id}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt17');
    departureAt = DateTime.utc()
      .plus({ days: 40 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();
    // The moderator's airline has a policy (FLT-08, FLT-09); the other has none.
    await fx.airlines
      .updateOne(
        { _id: fx.airlineId },
        {
          $set: {
            'policy.cancellationTiers': [
              { daysBefore: 7, refundPercent: 80 },
              { daysBefore: 1, refundPercent: 20 },
            ],
            'policy.extraBagPrice': 4500,
            'policy.maxExtraBags': 2,
          },
        },
      )
      .exec();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('shows a guest the airline, the flight, both times in UTC and local time, the duration, each cabin and the airline policy', async () => {
    const arrivalAt = new Date(departureAt.getTime() + 11.5 * HOUR_MS);
    const id = await fx.insertFlight({
      departureAt,
      arrivalAt,
      cabins: [
        { totalSeats: 100, bookedSeats: 40, heldSeats: 2, price: 25000 },
        {
          cabin: CabinClass.Business,
          totalSeats: 12,
          bookedSeats: 12,
          price: 90000,
          freeBags: 2,
          maxBagKg: 32,
        },
      ],
    });
    const flight = await fx.flights.findById(id).lean().exec();
    const airline = await fx.airlines.findById(fx.airlineId).lean().exec();

    const response = await details(id).expect(200);

    expect(response.body).toEqual({
      id,
      flightNumber: flight?.flightNumber,
      departureAirport: fx.airports.departure,
      arrivalAirport: fx.airports.arrival,
      departureAt: departureAt.toISOString(),
      arrivalAt: arrivalAt.toISOString(),
      departureLocal: localIn(departureAt, FIXTURE_ZONES.departure),
      departureTimeZone: FIXTURE_ZONES.departure,
      departureUtcOffset: expect.stringMatching(/^\+0[23]:00$/),
      arrivalLocal: localIn(arrivalAt, FIXTURE_ZONES.arrival),
      arrivalTimeZone: FIXTURE_ZONES.arrival,
      arrivalUtcOffset: expect.stringMatching(/^-0[45]:00$/),
      departureDateLocal: flight?.departureDateLocal,
      status: 'scheduled',
      airline: {
        id: fx.airlineId,
        name: airline?.name,
        code: airline?.code,
        logoUrl: `/api/uploads/${airline?.logo}`,
      },
      durationMinutes: 690,
      cabins: [
        {
          id: flight?.cabins[0]._id.toString(),
          cabin: 'economy',
          price: 25000,
          currency: 'USD',
          seatsRemaining: 58,
          freeBags: 1,
          maxBagKg: 23,
        },
        {
          id: flight?.cabins[1]._id.toString(),
          cabin: 'business',
          price: 90000,
          currency: 'USD',
          seatsRemaining: 0,
          freeBags: 2,
          maxBagKg: 32,
        },
      ],
      extraBagPrice: 4500,
      extraBagCurrency: 'USD',
      maxExtraBags: 2,
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 80 },
        { daysBefore: 1, refundPercent: 20 },
      ],
    });
    const shown = JSON.stringify(response.body);
    for (const hidden of ['bookedSeats', 'heldSeats', 'totalSeats', '__v']) {
      expect(shown).not.toContain(hidden);
    }
  });

  it.each([
    ['a registered user', () => fx.user],
    ['an airline moderator', () => fx.moderator],
    ['an administrator', () => fx.admin],
  ])('shows %s the same page as a guest', async (_label, actor) => {
    const id = await fx.insertFlight({ departureAt, cabins: [{}] });

    const asGuest = await details(id).expect(200);
    const asActor = await details(id, actor().cookie).expect(200);

    expect(asActor.body).toEqual(asGuest.body);
  });

  it('answers 404 for an unknown flight and 400 for a malformed id', async () => {
    const unknown = await details(new Types.ObjectId().toString()).expect(404);
    const malformed = await details('not-an-id').expect(400);

    expect(unknown.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    expect(malformed.body.message).toBe(
      'id must be a valid id (24 hexadecimal characters)',
    );
  });

  it('never reads /api/flights/search as an id: the search answers it', async () => {
    const response = await fx.http().get('/api/flights/search').expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(
      (response.body.errors as { field: string }[]).map((error) => error.field),
    ).toEqual(
      expect.arrayContaining([
        'departureAirport',
        'arrivalAirport',
        'departureDate',
        'passengers',
      ]),
    );
  });

  it('answers 404 for a flight of a deactivated airline (ACC-15), and shows it again once reactivated', async () => {
    const id = await fx.insertFlight({
      airlineId: fx.otherAirlineId,
      departureAt,
      cabins: [{}],
    });

    await fx.airlines
      .updateOne({ _id: fx.otherAirlineId }, { $set: { active: false } })
      .exec();
    const hidden = await details(id).expect(404);
    await fx.airlines
      .updateOne({ _id: fx.otherAirlineId }, { $set: { active: true } })
      .exec();
    const shown = await details(id).expect(200);

    expect(hidden.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    // An airline with no policy: no extra bag and no tiers.
    expect(shown.body).toMatchObject({
      id,
      extraBagPrice: null,
      extraBagCurrency: 'USD',
      maxExtraBags: 0,
      cancellationTiers: [],
    });
  });

  it.each([
    ['a cancelled flight', { status: FlightStatus.Cancelled }, 'cancelled'],
    ['a departed flight', { status: FlightStatus.Departed }, 'departed'],
    [
      'a flight still stored as scheduled whose departure has passed (FLT-30)',
      {
        departureAt: new Date(Date.now() - 2 * HOUR_MS),
        arrivalAt: new Date(Date.now() + 6 * HOUR_MS),
      },
      'departed',
    ],
  ])('shows %s with its status', async (_label, options, status) => {
    const id = await fx.insertFlight({ departureAt, ...options });

    const response = await details(id).expect(200);

    expect(response.body.status).toBe(status);
  });

  it('shows a flight without cabins yet with an empty list', async () => {
    const id = await fx.insertFlight({ departureAt });

    const response = await details(id).expect(200);

    expect(response.body.cabins).toEqual([]);
  });

  it('documents the page in Swagger: public, no lock, every answer and every field', async () => {
    const response = await fx.http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/flights/{id}'].get as {
      tags: string[];
      security?: unknown[];
      responses: Record<string, unknown>;
    };
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, SwaggerProperty> }
    >;

    expect(operation.tags).toEqual(['Flights']);
    expect(operation.security ?? []).toEqual([]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '404',
    ]);
    expect(
      Object.keys(schemas.FlightDetailsResponseDto.properties).sort(),
    ).toEqual(
      [
        'id',
        'flightNumber',
        'departureAirport',
        'arrivalAirport',
        'departureAt',
        'arrivalAt',
        'departureLocal',
        'departureTimeZone',
        'departureUtcOffset',
        'arrivalLocal',
        'arrivalTimeZone',
        'arrivalUtcOffset',
        'departureDateLocal',
        'status',
        'airline',
        'durationMinutes',
        'cabins',
        'extraBagPrice',
        'extraBagCurrency',
        'maxExtraBags',
        'cancellationTiers',
      ].sort(),
    );
    expect(
      Object.keys(schemas.FlightDetailsCabinResponseDto.properties).sort(),
    ).toEqual([
      'cabin',
      'currency',
      'freeBags',
      'id',
      'maxBagKg',
      'price',
      'seatsRemaining',
    ]);
    for (const name of [
      'FlightDetailsResponseDto',
      'FlightDetailsCabinResponseDto',
    ]) {
      for (const [field, property] of Object.entries(
        schemas[name].properties,
      )) {
        expect({ field, described: Boolean(property.description) }).toEqual({
          field,
          described: true,
        });
        if (
          !['airline', 'cabins', 'cancellationTiers', 'status'].includes(field)
        ) {
          expect({ field, example: property.example !== undefined }).toEqual({
            field,
            example: true,
          });
        }
      }
    }
  });
});
