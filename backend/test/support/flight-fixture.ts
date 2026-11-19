import './auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../../src/app.module';
import { configureApp, setupSwagger } from './../../src/app.setup';
import { ProviderType } from './../../src/common/enums/provider-type.enum';
import { Role } from './../../src/common/enums/role.enum';
import { Airline } from './../../src/flights/models/airline.schema';
import { CabinClass } from './../../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../../src/flights/models/flight-status.enum';
import {
  Flight,
  type FlightCabin,
} from './../../src/flights/models/flight.schema';
import { Airport } from './../../src/reference/models/airport.schema';
import { User } from './../../src/users/models/user.schema';
import { deleteSessionsOf } from './delete-sessions';
import { sessionCookieFor } from './session-cookie';

const DUPLICATE_KEY = 11000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The time zones of the fixture's two airports. */
export const FIXTURE_ZONES = {
  departure: 'Africa/Cairo',
  arrival: 'America/New_York',
} as const;

/** The official airport codes, which a test must never create or delete. */
const OFFICIAL_CODES = new Set(
  readFileSync(
    join(
      __dirname,
      '..',
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

const randomLetters = (length: number): string =>
  Array.from({ length }, () => String.fromCharCode(65 + randomInt(26))).join(
    '',
  );

/** A flight number no other run uses: 2 letters and 6 digits. */
export const newFlightNumber = (): string =>
  `${randomLetters(2)}${String(randomInt(1_000_000)).padStart(6, '0')}`;

export interface Actor {
  id: string;
  cookie: string;
}

/** A cabin as the fixture stores it straight in the database. */
export type StoredCabin = Partial<Omit<FlightCabin, '_id'>> & {
  _id?: Types.ObjectId;
};

export interface InsertFlightOptions {
  /** Default: 30 days from now. */
  departureAt?: Date;
  /** Default: 12 hours after the departure. */
  arrivalAt?: Date;
  /** Default: `airlineId`. Must be one of the fixture's two airlines, so cleanup deletes the flight. */
  airlineId?: string;
  /** Default: the fixture's departure airport. Must be an airport the fixture made. */
  departureAirport?: string;
  /** Default: the fixture's arrival airport. Must be an airport the fixture made. */
  arrivalAirport?: string;
  /** Default: scheduled. */
  status?: FlightStatus;
  /** Default: no cabin. Missing cabin fields get the fixture's values. */
  cabins?: StoredCabin[];
}

export interface FlightFixture {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  flights: Model<Flight>;
  airlines: Model<Airline>;
  /** A token unique to this run, in every name and email the fixture makes. */
  run: string;
  airports: { departure: string; arrival: string };
  airlineId: string;
  otherAirlineId: string;
  /** The airline moderator assigned to `airlineId`. */
  moderator: Actor;
  /** The airline moderator assigned to `otherAirlineId`. */
  otherModerator: Actor;
  /** An airline moderator with no assigned airline. */
  unassignedModerator: Actor;
  /** An airline moderator whose assignment names an airline that does not exist. */
  orphanModerator: Actor;
  hotelModerator: Actor;
  admin: Actor;
  user: Actor;
  /** Inserts a flight straight in the database and returns its id. */
  insertFlight: (options?: InsertFlightOptions) => Promise<string>;
  /**
   * Adds one more airport with a random free code in this IANA time zone,
   * deleted by cleanup, and returns its code.
   */
  createAirport: (timeZone: string, countryCode: string) => Promise<string>;
  /** A complete cabin as stored, with a new id and no seat booked or held. */
  storedCabin: (fields?: StoredCabin) => Required<StoredCabin>;
  /** Deletes every record the fixture and its tests made, one by one by id. */
  cleanup: () => Promise<void>;
}

/**
 * Shared setup for the flight end-to-end tests (FLT-04, FLT-30). The test
 * database may hold no reference data (CI starts empty), so it adds two
 * airports with random codes that are neither official nor in the database,
 * two airlines and one account per role. Accounts get a live session (ACC-06).
 * Every name and email carries `run`, and cleanup deletes only the ids it
 * created, so suites running at the same time never touch each other's data.
 * If setup fails halfway, what it already made is deleted before the error
 * is thrown.
 */
export async function createFlightFixture(
  label: string,
): Promise<FlightFixture> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app);
  setupSwagger(app);
  await app.init();

  const users = app.get<Model<User>>(getModelToken(User.name));
  const airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
  const airportModel = app.get<Model<Airport>>(getModelToken(Airport.name));
  const flights = app.get<Model<Flight>>(getModelToken(Flight.name));

  const run = `${label}-${randomUUID().slice(0, 8)}`;
  /** What the fixture created, recorded as soon as it exists, so cleanup finds it. */
  const userIds: string[] = [];
  const airlineIds: string[] = [];
  const airportCodes: string[] = [];
  /** The time zone of each airport the fixture made. */
  const zoneOf = new Map<string, string>();
  const http = () => request(app.getHttpServer());

  /**
   * Deletes every record the fixture recorded, one by one by id. A failed
   * delete does not stop the others, and the app is always closed; the first
   * error is thrown at the end so the test run shows it.
   */
  const cleanup = async (): Promise<void> => {
    let firstError: unknown;
    const attempt = async (step: () => Promise<unknown>): Promise<void> => {
      try {
        await step();
      } catch (error) {
        firstError ??= error;
      }
    };
    try {
      // Every flight of the fixture's airlines was made by its tests.
      await attempt(async () => {
        const ours = await flights
          .find({ airlineId: { $in: airlineIds } })
          .select('_id')
          .lean()
          .exec();
        for (const { _id } of ours) {
          await attempt(() => flights.findByIdAndDelete(_id).exec());
        }
      });
      for (const id of userIds) {
        await attempt(() => deleteSessionsOf(app, id));
        await attempt(() => users.findByIdAndDelete(id).exec());
      }
      for (const id of airlineIds) {
        await attempt(() => airlines.findByIdAndDelete(id).exec());
      }
      for (const code of airportCodes) {
        await attempt(() => airportModel.findByIdAndDelete(code).exec());
      }
    } finally {
      await app.close();
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  };

  /** An airport with a random free code. Suites run at the same time, so a code taken in between is tried again. */
  const createAirport = async (
    timeZone: string,
    countryCode: string,
  ): Promise<string> => {
    for (;;) {
      const code = randomLetters(3);
      if (OFFICIAL_CODES.has(code)) continue;
      try {
        await airportModel.create({
          _id: code,
          name: `${run} airport ${code}`,
          cityId: `${run}-city`,
          countryCode,
          timeZone,
        });
        airportCodes.push(code);
        zoneOf.set(code, timeZone);
        return code;
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      }
    }
  };

  const createAirline = async (): Promise<string> => {
    const airline = await airlines.create({
      name: `${run} airline`,
      code: `F${randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`,
      logo: `${run}-${randomUUID()}.png`,
    });
    const id = airline._id.toString();
    airlineIds.push(id);
    return id;
  };

  const createActor = async (
    role: Role,
    assignment?: { providerType: ProviderType; providerId: string },
  ): Promise<Actor> => {
    const created = await users.create({
      name: `${run} ${role}`,
      email: `${run}-${role}-${randomUUID()}@example.com`,
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
    userIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  const airlineModerator = (providerId: string) =>
    createActor(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId,
    });

  const storedCabin = (fields: StoredCabin = {}): Required<StoredCabin> => ({
    _id: new Types.ObjectId(),
    cabin: CabinClass.Economy,
    totalSeats: 100,
    bookedSeats: 0,
    heldSeats: 0,
    price: 10000,
    freeBags: 1,
    maxBagKg: 23,
    ...fields,
  });

  try {
    // The duplicate-number rule is a unique index: make sure it exists.
    await flights.init();
    const departure = await createAirport(FIXTURE_ZONES.departure, 'EG');
    const arrival = await createAirport(FIXTURE_ZONES.arrival, 'US');
    const airlineId = await createAirline();
    const otherAirlineId = await createAirline();

    /** Always a flight of the fixture's own airline, so cleanup deletes it. */
    const insertFlight = async (
      options: InsertFlightOptions = {},
    ): Promise<string> => {
      const departureAt =
        options.departureAt ?? new Date(Date.now() + 30 * DAY_MS);
      const owner = options.airlineId ?? airlineId;
      const from = options.departureAirport ?? departure;
      const to = options.arrivalAirport ?? arrival;
      const zone = zoneOf.get(from);
      if (
        ![airlineId, otherAirlineId].includes(owner) ||
        !zone ||
        !zoneOf.has(to)
      ) {
        throw new Error(
          'insertFlight only uses the fixture airlines and airports',
        );
      }
      const flight = await flights.create({
        airlineId: new Types.ObjectId(owner),
        flightNumber: newFlightNumber(),
        departureAirport: from,
        arrivalAirport: to,
        departureAt,
        arrivalAt:
          options.arrivalAt ?? new Date(departureAt.getTime() + 12 * HOUR_MS),
        departureDateLocal: DateTime.fromJSDate(departureAt, {
          zone,
        }).toFormat('yyyy-MM-dd'),
        status: options.status ?? FlightStatus.Scheduled,
        cabins: (options.cabins ?? []).map(storedCabin),
      });
      return flight._id.toString();
    };

    return {
      app,
      http,
      flights,
      airlines,
      run,
      airports: { departure, arrival },
      airlineId,
      otherAirlineId,
      moderator: await airlineModerator(airlineId),
      otherModerator: await airlineModerator(otherAirlineId),
      unassignedModerator: await createActor(Role.AirlineModerator),
      orphanModerator: await airlineModerator(new Types.ObjectId().toString()),
      hotelModerator: await createActor(Role.HotelModerator, {
        providerType: ProviderType.Hotel,
        providerId: new Types.ObjectId().toString(),
      }),
      admin: await createActor(Role.Admin),
      user: await createActor(Role.User),
      insertFlight,
      createAirport,
      storedCabin,
      cleanup,
    };
  } catch (error) {
    // Setup failed halfway: delete what was already made, then report it.
    await cleanup().catch(() => undefined);
    throw error;
  }
}
