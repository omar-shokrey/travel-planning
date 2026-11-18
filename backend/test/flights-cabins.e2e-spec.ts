import './support/auth-env';
import { Types } from 'mongoose';
import type request from 'supertest';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_NOT_FOUND_MESSAGE,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
  EMPTY_CABIN_UPDATE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
  newFlightNumber,
} from './support/flight-fixture';

interface CabinBody {
  id: string;
  cabin: string;
  totalSeats: number;
  availableSeats: number;
  price: number;
  currency: string;
  freeBags: number;
  maxBagKg: number;
}

interface FieldError {
  field: string;
  messages: string[];
}

const DAY_MS = 24 * 3_600_000;

/** A valid body for POST /api/flights/:id/cabins. */
const cabinBody = (fields: Record<string, unknown> = {}) => ({
  cabin: CabinClass.Economy,
  totalSeats: 180,
  price: 25000,
  freeBags: 1,
  maxBagKg: 23,
  ...fields,
});

const CABIN_KEYS = [
  'availableSeats',
  'cabin',
  'currency',
  'freeBags',
  'id',
  'maxBagKg',
  'price',
  'totalSeats',
];

describe('Flight cabins (e2e, FLT-04)', () => {
  let fx: FlightFixture;

  const post = (flightId: string, body: unknown, actor?: Actor) => {
    const call = fx.http().post(`/api/flights/${flightId}/cabins`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  const patch = (
    flightId: string,
    cabinId: string,
    body: unknown,
    actor?: Actor,
  ) => {
    const call = fx.http().patch(`/api/flights/${flightId}/cabins/${cabinId}`);
    return (actor ? call.set('Cookie', actor.cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  const fieldsOf = (response: request.Response): string[] =>
    (response.body.errors as FieldError[]).map((error) => error.field);

  /** The flight as stored, to prove what a request changed or did not change. */
  const storedFlight = (flightId: string) =>
    fx.flights.findById(flightId).lean().orFail().exec();

  /** A flight with one stored economy cabin; returns both ids. */
  const flightWithCabin = async (
    cabin: Parameters<FlightFixture['storedCabin']>[0] = {},
  ) => {
    const stored = fx.storedCabin(cabin);
    const flightId = await fx.insertFlight({ cabins: [stored] });
    return { flightId, cabinId: stored._id.toString() };
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt04');
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  describe('who may call the routes', () => {
    let flightId: string;
    let cabinId: string;

    beforeAll(async () => {
      ({ flightId, cabinId } = await flightWithCabin());
    });

    afterEach(async () => {
      // No refused request changed the flight.
      const flight = await storedFlight(flightId);
      expect(flight.cabins).toHaveLength(1);
      expect(flight.cabins[0].price).toBe(10000);
    });

    it('answers 401 to a guest, on both routes', async () => {
      const added = await post(flightId, cabinBody({ cabin: 'business' }));
      const changed = await patch(flightId, cabinId, { price: 1 });

      expect([added.status, changed.status]).toEqual([401, 401]);
      expect(added.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(changed.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it.each(['user', 'admin', 'hotelModerator'] as const)(
      'answers 403 to the %s account, on both routes',
      async (name) => {
        const added = await post(
          flightId,
          cabinBody({ cabin: 'business' }),
          fx[name],
        );
        const changed = await patch(flightId, cabinId, { price: 1 }, fx[name]);

        expect([added.status, changed.status]).toEqual([403, 403]);
      },
    );

    it('answers 403 to an airline moderator with no airline', async () => {
      const added = await post(
        flightId,
        cabinBody({ cabin: 'business' }),
        fx.unassignedModerator,
      );
      const changed = await patch(
        flightId,
        cabinId,
        { price: 1 },
        fx.unassignedModerator,
      );

      expect([added.status, changed.status]).toEqual([403, 403]);
      expect(added.body.message).toBe('You are not assigned to an airline');
      expect(changed.body.message).toBe('You are not assigned to an airline');
    });

    it('answers 403 to the moderator of another airline', async () => {
      const added = await post(
        flightId,
        cabinBody({ cabin: 'business' }),
        fx.otherModerator,
      );
      const changed = await patch(
        flightId,
        cabinId,
        { price: 1 },
        fx.otherModerator,
      );

      expect([added.status, changed.status]).toEqual([403, 403]);
      expect(added.body.message).toBe(FOREIGN_FLIGHT_MESSAGE);
      expect(changed.body.message).toBe(FOREIGN_FLIGHT_MESSAGE);
    });

    it('answers 404 to a moderator whose airline no longer exists', async () => {
      const added = await post(
        flightId,
        cabinBody({ cabin: 'business' }),
        fx.orphanModerator,
      );

      expect(added.status).toBe(404);
      expect(added.body.message).toBe('Airline not found');
    });
  });

  describe('ids', () => {
    it('answers 404 for a flight that does not exist, on both routes', async () => {
      const unknown = new Types.ObjectId().toString();

      const added = await post(unknown, cabinBody(), fx.moderator);
      const changed = await patch(
        unknown,
        new Types.ObjectId().toString(),
        { price: 1 },
        fx.moderator,
      );

      expect([added.status, changed.status]).toEqual([404, 404]);
      expect(added.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
      expect(changed.body.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    });

    it('answers 400 for a flight id or a cabin id that is not an id', async () => {
      const { flightId } = await flightWithCabin();

      const badFlight = await post('not-an-id', cabinBody(), fx.moderator);
      const badCabin = await patch(
        flightId,
        'not-an-id',
        { price: 1 },
        fx.moderator,
      );

      expect([badFlight.status, badCabin.status]).toEqual([400, 400]);
      expect(badFlight.body.message).toBe(
        'id must be a valid id (24 hexadecimal characters)',
      );
      expect(badCabin.body.message).toBe(
        'cabinId must be a valid id (24 hexadecimal characters)',
      );
    });

    it('answers 404 for a cabin id the flight does not have, also one of another flight', async () => {
      const { flightId } = await flightWithCabin();
      const other = await flightWithCabin();

      for (const cabinId of [new Types.ObjectId().toString(), other.cabinId]) {
        const response = await patch(
          flightId,
          cabinId,
          { price: 1 },
          fx.moderator,
        );
        expect([response.status, response.body.message]).toEqual([
          404,
          CABIN_NOT_FOUND_MESSAGE,
        ]);
      }
      expect((await storedFlight(other.flightId)).cabins[0].price).toBe(10000);
    });
  });

  describe('adding cabins', () => {
    it('adds all four classes, each answered 201 with the whole flight', async () => {
      const flightId = await fx.insertFlight();
      const bodies = [
        cabinBody({ cabin: 'economy', totalSeats: 180, price: 25000 }),
        cabinBody({
          cabin: 'premium_economy',
          totalSeats: 40,
          price: 60000,
          freeBags: 2,
        }),
        cabinBody({
          cabin: 'business',
          totalSeats: 24,
          price: 150000,
          freeBags: 2,
          maxBagKg: 32,
        }),
        cabinBody({
          cabin: 'first',
          totalSeats: 8,
          price: 400000,
          freeBags: 3,
          maxBagKg: 32,
        }),
      ];

      let last: request.Response | undefined;
      for (const body of bodies) {
        last = await post(flightId, body, fx.moderator);
        expect(last.status).toBe(201);
      }

      const flight = last?.body as { id: string; cabins: CabinBody[] };
      expect(flight.id).toBe(flightId);
      expect(flight.cabins).toEqual(
        bodies.map((body) => ({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          ...body,
          availableSeats: body.totalSeats,
          currency: 'USD',
        })),
      );
      for (const cabin of flight.cabins) {
        expect(Object.keys(cabin).sort()).toEqual(CABIN_KEYS);
      }
      expect(new Set(flight.cabins.map((cabin) => cabin.id)).size).toBe(4);

      const stored = await storedFlight(flightId);
      expect(
        stored.cabins.map((cabin) => [
          cabin._id.toString(),
          cabin.bookedSeats,
          cabin.heldSeats,
        ]),
      ).toEqual(flight.cabins.map((cabin) => [cabin.id, 0, 0]));
    });

    it('answers 409 for a class the flight already has, and stores nothing', async () => {
      const { flightId } = await flightWithCabin();

      const response = await post(
        flightId,
        cabinBody({ totalSeats: 5 }),
        fx.moderator,
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'This flight already has an economy cabin',
      );
      const stored = await storedFlight(flightId);
      expect(stored.cabins.map((cabin) => cabin.totalSeats)).toEqual([100]);
    });

    it('decides "each class once" in the write: 5 identical requests at once give one 201 and four 409', async () => {
      const flightId = await fx.insertFlight();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(flightId, cabinBody({ cabin: 'business' }), fx.moderator),
        ),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409, 409, 409, 409,
      ]);
      for (const response of responses.filter((r) => r.status === 409)) {
        expect(response.body.message).toBe(
          'This flight already has a business cabin',
        );
      }
      const stored = await storedFlight(flightId);
      expect(stored.cabins.map((cabin) => cabin.cabin)).toEqual(['business']);
    });

    it('keeps every cabin when four different classes are added at once', async () => {
      const flightId = await fx.insertFlight();

      const responses = await Promise.all(
        Object.values(CabinClass).map((cabin) =>
          post(flightId, cabinBody({ cabin }), fx.moderator),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([
        201, 201, 201, 201,
      ]);
      const stored = await storedFlight(flightId);
      expect(stored.cabins.map((cabin) => cabin.cabin).sort()).toEqual(
        Object.values(CabinClass).sort(),
      );
    });

    it('lets the moderator of a deactivated airline define cabins (ACC-15 only blocks booking)', async () => {
      const flightId = await fx.insertFlight();
      await fx.airlines
        .updateOne({ _id: fx.airlineId }, { $set: { active: false } })
        .exec();
      try {
        const response = await post(flightId, cabinBody(), fx.moderator);
        expect(response.status).toBe(201);
      } finally {
        await fx.airlines
          .updateOne({ _id: fx.airlineId }, { $set: { active: true } })
          .exec();
      }
    });
  });

  describe('validation of a new cabin (400, nothing stored)', () => {
    let flightId: string;

    beforeAll(async () => {
      flightId = await fx.insertFlight();
    });

    afterEach(async () => {
      expect((await storedFlight(flightId)).cabins).toEqual([]);
    });

    it.each([
      ['a price of 0', { price: 0 }, 'price', 'price must be more than 0'],
      [
        'a price of 1.5 (not whole cents)',
        { price: 1.5 },
        'price',
        'price must be a whole number of minor units (cents)',
      ],
      [
        'a price above our limit',
        { price: CABIN_PRICE_MAX + 1 },
        'price',
        `price must be at most ${CABIN_PRICE_MAX}`,
      ],
      [
        '0 seats',
        { totalSeats: 0 },
        'totalSeats',
        'totalSeats must be more than 0',
      ],
      [
        '2.5 seats',
        { totalSeats: 2.5 },
        'totalSeats',
        'totalSeats must be a whole number',
      ],
      [
        'more seats than our limit',
        { totalSeats: CABIN_SEATS_MAX + 1 },
        'totalSeats',
        `totalSeats must be at most ${CABIN_SEATS_MAX}`,
      ],
      [
        '-1 free bags',
        { freeBags: -1 },
        'freeBags',
        'freeBags must be 0 or more',
      ],
      [
        'more free bags than our limit',
        { freeBags: CABIN_FREE_BAGS_MAX + 1 },
        'freeBags',
        `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
      ],
      [
        'a bag weight of 0 kg, even with no free bag',
        { freeBags: 0, maxBagKg: 0 },
        'maxBagKg',
        'maxBagKg must be at least 1',
      ],
      [
        'a bag weight above our limit',
        { maxBagKg: CABIN_BAG_WEIGHT_MAX_KG + 1 },
        'maxBagKg',
        `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
      ],
      [
        'a class not in the set',
        { cabin: 'premium' },
        'cabin',
        'cabin must be one of economy, premium_economy, business, first',
      ],
      [
        'a number sent as text',
        { totalSeats: '180' },
        'totalSeats',
        'totalSeats must be a whole number',
      ],
    ])('refuses %s', async (_case, fields, field, message) => {
      const response = await post(flightId, cabinBody(fields), fx.moderator);

      expect(response.status).toBe(400);
      expect(fieldsOf(response)).toEqual([field]);
      expect(response.body.errors[0].messages).toContain(message);
    });

    it.each(['cabin', 'totalSeats', 'price', 'freeBags', 'maxBagKg'])(
      'refuses a body without %s, and one with %s null',
      async (field) => {
        const { [field as 'cabin']: _left, ...missing } = cabinBody();

        const left = await post(flightId, missing, fx.moderator);
        const empty = await post(
          flightId,
          cabinBody({ [field]: null }),
          fx.moderator,
        );

        expect([left.status, empty.status]).toEqual([400, 400]);
        expect(fieldsOf(left)).toEqual([field]);
        expect(fieldsOf(empty)).toEqual([field]);
      },
    );

    it.each([
      ['bookedSeats', 0],
      ['heldSeats', 0],
      ['currency', 'EUR'],
      ['id', new Types.ObjectId().toString()],
      ['_id', new Types.ObjectId().toString()],
      ['availableSeats', 180],
    ])('refuses %s, which only the server sets', async (field, value) => {
      const response = await post(
        flightId,
        cabinBody({ [field]: value }),
        fx.moderator,
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
    });
  });

  describe('flights that are not scheduled (409, nothing changed)', () => {
    it.each([FlightStatus.Cancelled, FlightStatus.Departed])(
      'refuses to add or edit a cabin of a %s flight',
      async (status) => {
        const stored = fx.storedCabin();
        const flightId = await fx.insertFlight({
          status,
          cabins: [stored],
        });

        const added = await post(
          flightId,
          cabinBody({ cabin: 'first' }),
          fx.moderator,
        );
        const changed = await patch(
          flightId,
          stored._id.toString(),
          { price: 1 },
          fx.moderator,
        );

        expect([added.status, changed.status]).toEqual([409, 409]);
        expect(added.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
        expect(changed.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
        const flight = await storedFlight(flightId);
        expect(
          flight.cabins.map((cabin) => [cabin.cabin, cabin.price]),
        ).toEqual([['economy', 10000]]);
      },
    );
  });

  describe('editing a cabin', () => {
    it.each([
      ['totalSeats', 250],
      ['price', 30000],
      ['freeBags', 0],
      ['maxBagKg', 30],
    ])('changes %s alone and keeps the other fields', async (field, value) => {
      const { flightId, cabinId } = await flightWithCabin();
      const before = await storedFlight(flightId);

      const response = await patch(
        flightId,
        cabinId,
        { [field]: value },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      const expected = {
        id: cabinId,
        cabin: 'economy',
        totalSeats: 100,
        availableSeats: 100,
        price: 10000,
        currency: 'USD',
        freeBags: 1,
        maxBagKg: 23,
        [field]: value,
        ...(field === 'totalSeats' && { availableSeats: value }),
      };
      expect(response.body.cabins).toEqual([expected]);
      const after = await storedFlight(flightId);
      expect(after.cabins[0]).toMatchObject({
        [field]: value,
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before.updatedAt.getTime(),
      );
    });

    it('changes all four fields at once', async () => {
      const { flightId, cabinId } = await flightWithCabin();

      const response = await patch(
        flightId,
        cabinId,
        { totalSeats: 120, price: 1, freeBags: 2, maxBagKg: 1 },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(response.body.cabins[0]).toMatchObject({
        totalSeats: 120,
        availableSeats: 120,
        price: 1,
        freeBags: 2,
        maxBagKg: 1,
      });
    });

    it('edits only the cabin named, not the other cabins of the flight', async () => {
      const economy = fx.storedCabin();
      const business = fx.storedCabin({ cabin: CabinClass.Business });
      const flightId = await fx.insertFlight({ cabins: [economy, business] });

      const response = await patch(
        flightId,
        business._id.toString(),
        { price: 99999 },
        fx.moderator,
      );

      expect(response.status).toBe(200);
      expect(
        (response.body.cabins as CabinBody[]).map((cabin) => [
          cabin.cabin,
          cabin.price,
        ]),
      ).toEqual([
        ['economy', 10000],
        ['business', 99999],
      ]);
    });

    it('refuses to change the class with 400', async () => {
      const { flightId, cabinId } = await flightWithCabin();

      const response = await patch(
        flightId,
        cabinId,
        { cabin: 'business' },
        fx.moderator,
      );

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'cabin', messages: ['property cabin should not exist'] },
      ]);
      expect((await storedFlight(flightId)).cabins[0].cabin).toBe('economy');
    });

    it.each([
      ['bookedSeats', 0],
      ['heldSeats', 0],
      ['currency', 'EUR'],
    ])('refuses %s, which only the server sets', async (field, value) => {
      const { flightId, cabinId } = await flightWithCabin();

      const response = await patch(
        flightId,
        cabinId,
        { price: 1, [field]: value },
        fx.moderator,
      );

      expect(response.status).toBe(400);
      expect(fieldsOf(response)).toEqual([field]);
      expect((await storedFlight(flightId)).cabins[0].price).toBe(10000);
    });

    it.each([
      ['a field sent as null', { price: null }, 'price'],
      ['a price of 0', { price: 0 }, 'price'],
      ['0 seats', { totalSeats: 0 }, 'totalSeats'],
      ['a bag weight of 0 kg', { maxBagKg: 0 }, 'maxBagKg'],
    ])('refuses %s with 400', async (_case, body, field) => {
      const { flightId, cabinId } = await flightWithCabin();

      const response = await patch(flightId, cabinId, body, fx.moderator);

      expect(response.status).toBe(400);
      expect(fieldsOf(response)).toEqual([field]);
    });

    it('refuses an empty body with 400', async () => {
      const { flightId, cabinId } = await flightWithCabin();

      const response = await patch(flightId, cabinId, {}, fx.moderator);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(EMPTY_CABIN_UPDATE_MESSAGE);
    });

    describe('the seat count and the seats already booked or held', () => {
      // 10 booked and 5 held, set straight in the database as a booking would.
      const counted = () =>
        flightWithCabin({ totalSeats: 100, bookedSeats: 10, heldSeats: 5 });

      it('refuses a seat count below them with 400 on totalSeats, naming the number', async () => {
        const { flightId, cabinId } = await counted();

        const response = await patch(
          flightId,
          cabinId,
          { totalSeats: 14 },
          fx.moderator,
        );

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([
          {
            field: 'totalSeats',
            messages: [
              'totalSeats cannot be below the 15 seats already booked or held',
            ],
          },
        ]);
        expect((await storedFlight(flightId)).cabins[0].totalSeats).toBe(100);
      });

      it('accepts a seat count equal to them: no seat left', async () => {
        const { flightId, cabinId } = await counted();

        const response = await patch(
          flightId,
          cabinId,
          { totalSeats: 15 },
          fx.moderator,
        );

        expect(response.status).toBe(200);
        expect(response.body.cabins[0]).toMatchObject({
          totalSeats: 15,
          availableSeats: 0,
        });
        expect(response.body.cabins[0]).not.toHaveProperty('bookedSeats');
        expect(response.body.cabins[0]).not.toHaveProperty('heldSeats');
      });

      it('applies the counters a booking wrote after the cabin was added', async () => {
        const { flightId, cabinId } = await flightWithCabin();
        await fx.flights
          .updateOne(
            { _id: flightId, 'cabins._id': new Types.ObjectId(cabinId) },
            { $set: { 'cabins.$.bookedSeats': 60, 'cabins.$.heldSeats': 2 } },
          )
          .exec();

        const below = await patch(
          flightId,
          cabinId,
          { totalSeats: 61 },
          fx.moderator,
        );
        const price = await patch(
          flightId,
          cabinId,
          { price: 12000 },
          fx.moderator,
        );

        expect(below.status).toBe(400);
        expect(below.body.errors[0].messages).toEqual([
          'totalSeats cannot be below the 62 seats already booked or held',
        ]);
        expect(price.status).toBe(200);
        expect(price.body.cabins[0]).toMatchObject({
          totalSeats: 100,
          availableSeats: 38,
          price: 12000,
        });
        const stored = (await storedFlight(flightId)).cabins[0];
        expect([stored.bookedSeats, stored.heldSeats]).toEqual([60, 2]);
      });
    });
  });

  describe('the schema backs the DTO in both writes (runValidators)', () => {
    it('refuses a pushed cabin that breaks a schema rule', async () => {
      const flightId = await fx.insertFlight();

      await expect(
        fx.flights
          .updateOne(
            { _id: flightId },
            { $push: { cabins: fx.storedCabin({ price: 0 }) } },
            { runValidators: true },
          )
          .exec(),
      ).rejects.toThrow(/price/);
      expect((await storedFlight(flightId)).cabins).toEqual([]);
    });

    it('refuses a positional $set that breaks a schema rule', async () => {
      const { flightId, cabinId } = await flightWithCabin();

      await expect(
        fx.flights
          .updateOne(
            { _id: flightId, 'cabins._id': new Types.ObjectId(cabinId) },
            { $set: { 'cabins.$.price': 12.5 } },
            { runValidators: true },
          )
          .exec(),
      ).rejects.toThrow(/price must be a whole number/);
      expect((await storedFlight(flightId)).cabins[0].price).toBe(10000);
    });
  });

  describe('POST /api/flights (FLT-03) still works', () => {
    it('creates a flight that starts with no cabins', async () => {
      const departureLocal = new Date(Date.now() + 45 * DAY_MS)
        .toISOString()
        .slice(0, 10);

      const response = await fx
        .http()
        .post('/api/flights')
        .set('Cookie', fx.moderator.cookie)
        .send({
          flightNumber: newFlightNumber(),
          departureAirport: fx.airports.departure,
          arrivalAirport: fx.airports.arrival,
          departureLocal: `${departureLocal}T10:00`,
          arrivalLocal: `${departureLocal}T20:00`,
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('scheduled');
      expect(response.body.cabins).toEqual([]);

      const added = await post(response.body.id, cabinBody(), fx.moderator);
      expect(added.status).toBe(201);
      expect(added.body.cabins).toHaveLength(1);
    });
  });

  it('documents both routes in Swagger under Flights, with the cookie and every answer', async () => {
    const document = (await fx.http().get('/api/docs-json').expect(200)).body;
    const add = document.paths['/api/flights/{id}/cabins'].post as {
      tags: string[];
      security: Record<string, unknown>[];
      responses: Record<string, unknown>;
      parameters: { name: string }[];
    };
    const edit = document.paths['/api/flights/{id}/cabins/{cabinId}']
      .patch as typeof add;
    const schemas = document.components.schemas as Record<
      string,
      {
        properties: Record<string, { description?: string; example?: unknown }>;
        enum?: string[];
      }
    >;

    for (const operation of [add, edit]) {
      expect(operation.tags).toEqual(['Flights']);
      expect(operation.security).toEqual([{ cookie: [] }]);
    }
    expect(Object.keys(add.responses).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(Object.keys(edit.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(add.parameters.map((parameter) => parameter.name)).toEqual(['id']);
    expect(edit.parameters.map((parameter) => parameter.name).sort()).toEqual([
      'cabinId',
      'id',
    ]);
    expect(Object.keys(schemas.CreateCabinDto.properties).sort()).toEqual([
      'cabin',
      'freeBags',
      'maxBagKg',
      'price',
      'totalSeats',
    ]);
    expect(Object.keys(schemas.UpdateCabinDto.properties).sort()).toEqual([
      'freeBags',
      'maxBagKg',
      'price',
      'totalSeats',
    ]);
    expect(Object.keys(schemas.CabinResponseDto.properties).sort()).toEqual(
      CABIN_KEYS,
    );
    expect(schemas.CabinClass.enum).toEqual([
      'economy',
      'premium_economy',
      'business',
      'first',
    ]);
    for (const name of [
      'CreateCabinDto',
      'UpdateCabinDto',
      'CabinResponseDto',
      'FlightResponseDto',
    ]) {
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
