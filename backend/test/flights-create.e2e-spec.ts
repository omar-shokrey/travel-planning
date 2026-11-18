import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { DUPLICATE_FLIGHT_MESSAGE } from './../src/flights/flights.constants';
import { Airline } from './../src/flights/models/airline.schema';
import { Flight } from './../src/flights/models/flight.schema';
import { Airport } from './../src/reference/models/airport.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/** The time zones of this test's own airports. */
const ZONES = {
  departure: 'Africa/Cairo',
  arrival: 'America/New_York',
  // No daylight saving: the expected UTC values can be written down.
  fixedPlusNine: 'Asia/Tokyo',
  fixedPlusFiveThirty: 'Asia/Kolkata',
} as const;
type ZoneName = keyof typeof ZONES;

const LOCAL = "yyyy-MM-dd'T'HH:mm";

/** The official airport codes, which this test must never create or delete. */
const OFFICIAL_CODES = new Set(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'docs',
      'requirements',
      'reference-data',
      'airports.csv',
    ),
    'utf8',
  )
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(',')[0])
    .filter(Boolean),
);

const randomCode = (): string =>
  Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join(
    '',
  );

/** A flight number no other run uses: 2 letters and 6 digits. */
const newFlightNumber = (): string =>
  `E${String.fromCharCode(65 + randomInt(26))}${String(randomInt(1_000_000)).padStart(6, '0')}`;

/**
 * A local date-time `days` from today (the UTC date) at the given time. The
 * same date text is used for every airport, so a departure and an arrival
 * written for "day 30" are on the same calendar day in their own zones.
 */
const localAt = (days: number, hour: number, minute = 0): string =>
  `${DateTime.utc().plus({ days }).toFormat('yyyy-MM-dd')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const utcOf = (local: string, zone: string): string =>
  DateTime.fromISO(local, { zone }).toUTC().toISO() as string;

/**
 * The first future day whose 02:30 does not exist in `zone`: the clocks
 * jump from 02:00 to 03:00 (luxon then gives 03:30). Searched with luxon, so
 * the case stays in the future whenever the test runs.
 */
function nextDaylightSavingGap(zone: string): string {
  const today = DateTime.now().setZone(zone).startOf('day');
  for (let days = 1; days <= 400; days += 1) {
    // Written as text: luxon's set() would already move 02:30 to 03:30.
    const local = `${today.plus({ days }).toFormat('yyyy-MM-dd')}T02:30`;
    if (DateTime.fromISO(local, { zone }).toFormat(LOCAL) !== local) {
      return local;
    }
  }
  throw new Error(`No daylight saving gap found in ${zone}`);
}

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  messages: string[];
}

describe('POST /api/flights (e2e, FLT-03)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let airlines: Model<Airline>;
  let airports: Model<Airport>;
  let flights: Model<Flight>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdAirlineIds: string[] = [];
  const createdAirportCodes: string[] = [];

  const codes = {} as Record<ZoneName, string>;
  let unknownCode: string;
  let airlineId: string;
  let moderator: Actor;
  let unassignedModerator: Actor;
  let hotelModerator: Actor;
  let admin: Actor;
  let registeredUser: Actor;

  const http = () => request(app.getHttpServer());

  const post = (body: unknown, actor?: Actor) => {
    const call = http().post('/api/flights');
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  /** A valid body: departure in 30 days at 14:30, arrival at 18:30, local. */
  const body = (fields: Record<string, unknown> = {}) => ({
    flightNumber: newFlightNumber(),
    departureAirport: codes.departure,
    arrivalAirport: codes.arrival,
    departureLocal: localAt(30, 14, 30),
    arrivalLocal: localAt(30, 18, 30),
    ...fields,
  });

  /** A code that is neither official nor in the -test database. */
  const freeCode = async (taken: Set<string>): Promise<string> => {
    for (;;) {
      const code = randomCode();
      if (
        !OFFICIAL_CODES.has(code) &&
        !taken.has(code) &&
        !(await airports.exists({ _id: code }))
      ) {
        taken.add(code);
        return code;
      }
    }
  };

  const createActor = async (
    role: Role,
    assignment?: { providerType: ProviderType; providerId: string },
  ): Promise<Actor> => {
    const created = await users.create({
      name: `FLT-03 ${role}`,
      email: `flt03-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(assignment && {
        assignment: {
          providerType: assignment.providerType,
          providerId: new Types.ObjectId(assignment.providerId),
        },
      }),
    });
    const id = created._id.toString();
    createdUserIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  const fieldsOf = (response: request.Response): string[] =>
    (response.body.errors as FieldError[]).map((error) => error.field);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    airports = app.get<Model<Airport>>(getModelToken(Airport.name));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    // The duplicate rule is the unique index: make sure it exists.
    await flights.init();

    const taken = new Set<string>();
    for (const name of Object.keys(ZONES) as ZoneName[]) {
      const code = await freeCode(taken);
      await airports.create({
        _id: code,
        name: `FLT-03 e2e ${name}`,
        cityId: 'flt03-e2e-city',
        countryCode: 'EG',
        timeZone: ZONES[name],
      });
      createdAirportCodes.push(code);
      codes[name] = code;
    }
    unknownCode = await freeCode(taken);

    const airline = await airlines.create({
      name: 'FLT-03 e2e airline',
      code: `F3${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      logo: `flt03-e2e-${randomUUID()}.png`,
    });
    airlineId = airline._id.toString();
    createdAirlineIds.push(airlineId);

    moderator = await createActor(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: airlineId,
    });
    unassignedModerator = await createActor(Role.AirlineModerator);
    hotelModerator = await createActor(Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: new Types.ObjectId().toString(),
    });
    admin = await createActor(Role.Admin);
    registeredUser = await createActor(Role.User);
  });

  afterAll(async () => {
    // Every flight of this test's airline was created by this test.
    const ours = await flights
      .find({ airlineId: { $in: createdAirlineIds } })
      .select('_id')
      .lean()
      .exec();
    for (const { _id } of ours) {
      await flights.findByIdAndDelete(_id).exec();
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id).exec();
    }
    for (const id of createdAirlineIds) {
      await airlines.findByIdAndDelete(id).exec();
    }
    for (const code of createdAirportCodes) {
      await airports.findByIdAndDelete(code).exec();
    }
    await app.close();
  });

  describe('creating a flight', () => {
    it('answers 201 with the local times stored in UTC, the local departure date and status scheduled', async () => {
      const sent = body();

      const response = await post(sent, moderator);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        airlineId,
        flightNumber: sent.flightNumber,
        departureAirport: codes.departure,
        arrivalAirport: codes.arrival,
        departureAt: utcOf(sent.departureLocal, ZONES.departure),
        arrivalAt: utcOf(sent.arrivalLocal, ZONES.arrival),
        departureDateLocal: sent.departureLocal.slice(0, 10),
        status: 'scheduled',
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
      const stored = await flights.findById(response.body.id).lean().orFail();
      expect(stored.airlineId.toString()).toBe(airlineId);
      expect(stored.departureAt.toISOString()).toBe(response.body.departureAt);
    });

    it('converts with the airport time zone (fixed offsets: UTC+9 to UTC+5:30)', async () => {
      const departureLocal = localAt(40, 14, 30);
      const arrivalLocal = localAt(40, 18, 30);
      const day = departureLocal.slice(0, 10);

      const response = await post(
        body({
          departureAirport: codes.fixedPlusNine,
          arrivalAirport: codes.fixedPlusFiveThirty,
          departureLocal,
          arrivalLocal,
        }),
        moderator,
      );

      expect(response.status).toBe(201);
      // 14:30 at UTC+9 is 05:30 UTC; 18:30 at UTC+5:30 is 13:00 UTC.
      expect(response.body.departureAt).toBe(`${day}T05:30:00.000Z`);
      expect(response.body.arrivalAt).toBe(`${day}T13:00:00.000Z`);
      expect(response.body.departureDateLocal).toBe(day);
    });

    it('takes the local departure date at the departure airport, not the UTC date', async () => {
      // 01:00 in Tokyo is 16:00 UTC on the day before.
      const departureLocal = localAt(45, 1, 0);

      const response = await post(
        body({
          departureAirport: codes.fixedPlusNine,
          arrivalAirport: codes.fixedPlusFiveThirty,
          departureLocal,
          arrivalLocal: localAt(45, 5, 0),
        }),
        moderator,
      );

      expect(response.status).toBe(201);
      expect(response.body.departureDateLocal).toBe(
        departureLocal.slice(0, 10),
      );
      expect(response.body.departureAt.slice(0, 10)).toBe(
        DateTime.fromISO(departureLocal.slice(0, 10))
          .minus({ days: 1 })
          .toISODate(),
      );
    });
  });

  describe('who may create a flight', () => {
    it('refuses a guest with 401', async () => {
      const response = await post(body());

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each([
      ['a registered user', () => registeredUser],
      ['an administrator', () => admin],
      ['a hotel moderator', () => hotelModerator],
    ])('refuses %s with 403', async (_label, actor) => {
      const response = await post(body(), actor());

      expect(response.status).toBe(403);
    });

    it('refuses an airline moderator with no assigned airline with 403', async () => {
      const response = await post(body(), unassignedModerator);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('You are not assigned to an airline');
    });
  });

  describe('invalid flights (400, naming the field)', () => {
    const cases: [string, () => Record<string, unknown>, string[]][] = [
      [
        'identical airports',
        () =>
          body({
            arrivalAirport: codes.departure,
            arrivalLocal: localAt(30, 18, 30),
          }),
        ['arrivalAirport'],
      ],
      [
        'an airport that is not in the airports list',
        () => body({ arrivalAirport: unknownCode }),
        ['arrivalAirport'],
      ],
      [
        'an arrival whose local clock is later but whose UTC moment is earlier',
        // 20:00 in New York is after 01:00 next day in Cairo, in UTC.
        () =>
          body({
            departureAirport: codes.arrival,
            arrivalAirport: codes.departure,
            departureLocal: localAt(30, 20, 0),
            arrivalLocal: localAt(31, 1, 0),
          }),
        ['arrivalLocal'],
      ],
      [
        'a departure in the past',
        () =>
          body({
            departureLocal: localAt(-1, 10, 0),
            arrivalLocal: localAt(-1, 23, 0),
          }),
        ['departureLocal'],
      ],
      [
        'a departure inside the daylight saving gap',
        () => {
          const gap = nextDaylightSavingGap(ZONES.arrival);
          return body({
            departureAirport: codes.arrival,
            arrivalAirport: codes.departure,
            departureLocal: gap,
            arrivalLocal: DateTime.fromISO(gap.slice(0, 10))
              .plus({ days: 1 })
              .set({ hour: 12 })
              .toFormat(LOCAL),
          });
        },
        ['departureLocal'],
      ],
      [
        'a local time with Z',
        () => body({ departureLocal: `${localAt(30, 14, 30)}Z` }),
        ['departureLocal'],
      ],
      [
        'a local time with an offset',
        () => body({ arrivalLocal: `${localAt(30, 18, 30)}-04:00` }),
        ['arrivalLocal'],
      ],
      [
        'a missing field',
        () => {
          const sent: Record<string, unknown> = body();
          delete sent.departureAirport;
          return sent;
        },
        ['departureAirport'],
      ],
      [
        'a field sent as null',
        () => body({ arrivalLocal: null }),
        ['arrivalLocal'],
      ],
      [
        'airlineId sent by the client',
        () => body({ airlineId: airlineId }),
        ['airlineId'],
      ],
      [
        'status sent by the client',
        () => body({ status: 'scheduled' }),
        ['status'],
      ],
      ['an extra field', () => body({ price: 100 }), ['price']],
      [
        'a flight number with a dash',
        () => body({ flightNumber: 'MS-1' }),
        ['flightNumber'],
      ],
    ];

    it.each(cases)('refuses %s', async (_label, make, fields) => {
      const before = await flights.countDocuments({ airlineId }).exec();

      const response = await post(make(), moderator);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(fieldsOf(response)).toEqual(fields);
      expect(await flights.countDocuments({ airlineId }).exec()).toBe(before);
    });

    it('lists several broken rules in one answer', async () => {
      const response = await post(
        body({
          departureAirport: unknownCode,
          departureLocal: localAt(-2, 10, 0),
          arrivalLocal: localAt(-3, 10, 0),
        }),
        moderator,
      );

      expect(response.status).toBe(400);
      // The departure airport is unknown, so its time cannot be read; the
      // arrival time is valid on its own.
      expect(fieldsOf(response)).toEqual(['departureAirport']);

      const many = await post(
        body({
          departureLocal: localAt(-2, 10, 0),
          arrivalLocal: localAt(-3, 10, 0),
        }),
        moderator,
      );
      expect(fieldsOf(many)).toEqual(['departureLocal', 'arrivalLocal']);
    });
  });

  describe('one flight number per airline and departure date', () => {
    let sent: ReturnType<typeof body>;

    beforeAll(async () => {
      sent = body({
        flightNumber: `MS${String(randomInt(10_000_000)).padStart(7, '0')}`,
      });
      const first = await post(sent, moderator);
      expect(first.status).toBe(201);
    });

    it('answers 409 for the same number on the same local departure date', async () => {
      const response = await post(
        {
          ...sent,
          departureLocal: sent.departureLocal.replace(/T\d\d:\d\d$/, 'T21:00'),
          arrivalLocal: sent.arrivalLocal.replace(/T\d\d:\d\d$/, 'T23:30'),
        },
        moderator,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(DUPLICATE_FLIGHT_MESSAGE);
    });

    it('answers 409 for the same number written in lower case with spaces', async () => {
      const response = await post(
        { ...sent, flightNumber: ` ${sent.flightNumber.toLowerCase()} ` },
        moderator,
      );

      expect(response.status).toBe(409);
    });

    it('lets one of two identical requests at the same moment win', async () => {
      const again = body({ flightNumber: newFlightNumber() });

      const statuses = (
        await Promise.all([post(again, moderator), post(again, moderator)])
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([201, 409]);
    });

    it('allows the same number on another local departure date', async () => {
      const response = await post(
        {
          ...sent,
          departureLocal: localAt(31, 9, 0),
          arrivalLocal: localAt(31, 13, 0),
        },
        moderator,
      );

      expect(response.status).toBe(201);
      expect(response.body.flightNumber).toBe(sent.flightNumber);
    });

    it('still blocks the number when the earlier flight was cancelled', async () => {
      const original = await flights
        .findOne({
          airlineId,
          flightNumber: sent.flightNumber,
          departureDateLocal: sent.departureLocal.slice(0, 10),
        })
        .orFail()
        .exec();
      await flights
        .updateOne({ _id: original._id }, { $set: { status: 'cancelled' } })
        .exec();

      const response = await post(sent, moderator);

      expect(response.status).toBe(409);
    });
  });

  it('documents the route in Swagger under Flights, with the cookie and every answer', async () => {
    const document = (await http().get('/api/docs-json').expect(200)).body;
    const operation = document.paths['/api/flights'].post as {
      tags: string[];
      security: Record<string, unknown>[];
      responses: Record<string, unknown>;
    };
    const schemas = document.components.schemas as Record<
      string,
      {
        properties: Record<string, { description?: string; example?: unknown }>;
      }
    >;

    expect(operation.tags).toEqual(['Flights']);
    expect(operation.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '409',
    ]);
    expect(Object.keys(schemas.CreateFlightDto.properties).sort()).toEqual([
      'arrivalAirport',
      'arrivalLocal',
      'departureAirport',
      'departureLocal',
      'flightNumber',
    ]);
    expect(Object.keys(schemas.FlightResponseDto.properties).sort()).toEqual([
      'airlineId',
      'arrivalAirport',
      'arrivalAt',
      'createdAt',
      'departureAirport',
      'departureAt',
      'departureDateLocal',
      'flightNumber',
      'id',
      'status',
      'updatedAt',
    ]);
    for (const name of ['CreateFlightDto', 'FlightResponseDto']) {
      for (const [field, property] of Object.entries(
        schemas[name].properties,
      )) {
        expect([name, field, typeof property.description]).toEqual([
          name,
          field,
          'string',
        ]);
        expect([name, field, property.example === undefined]).toEqual([
          name,
          field,
          false,
        ]);
      }
    }
  });
});
