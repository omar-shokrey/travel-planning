import './support/auth-env';
import { FLIGHT_NOT_SCHEDULED_MESSAGE } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  createFlightFixture,
  type FlightFixture,
  newFlightNumber,
} from './support/flight-fixture';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A valid body for POST /api/flights/:id/cabins. */
const businessCabin = {
  cabin: CabinClass.Business,
  totalSeats: 24,
  price: 150000,
  freeBags: 2,
  maxBagKg: 32,
};

/**
 * FLT-30 on the routes that exist today. The departure times are hours or
 * days away from now, so no test depends on the exact moment it runs.
 */
describe('Flight status (e2e, FLT-30)', () => {
  let fx: FlightFixture;

  const addCabin = (flightId: string) =>
    fx
      .http()
      .post(`/api/flights/${flightId}/cabins`)
      .set('Cookie', fx.moderator.cookie)
      .send(businessCabin);

  const editCabin = (flightId: string, cabinId: string) =>
    fx
      .http()
      .patch(`/api/flights/${flightId}/cabins/${cabinId}`)
      .set('Cookie', fx.moderator.cookie)
      .send({ price: 1 });

  /** The flight as stored, to prove that a refused request changed nothing. */
  const snapshot = async (flightId: string) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    return {
      status: flight.status,
      departureAt: flight.departureAt.toISOString(),
      cabins: flight.cabins.map((cabin) => ({
        id: cabin._id.toString(),
        cabin: cabin.cabin,
        totalSeats: cabin.totalSeats,
        bookedSeats: cabin.bookedSeats,
        heldSeats: cabin.heldSeats,
        price: cabin.price,
        freeBags: cabin.freeBags,
        maxBagKg: cabin.maxBagKg,
      })),
      updatedAt: flight.updatedAt.toISOString(),
    };
  };

  beforeAll(async () => {
    fx = await createFlightFixture('flt30');
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    await fx?.cleanup();
  });

  it('lets the moderator add and edit a cabin of a scheduled flight that departs in the future', async () => {
    const stored = fx.storedCabin();
    const flightId = await fx.insertFlight({
      departureAt: new Date(Date.now() + 2 * DAY_MS),
      cabins: [stored],
    });

    const added = await addCabin(flightId);
    const edited = await editCabin(flightId, stored._id.toString());

    expect([added.status, edited.status]).toEqual([201, 200]);
    expect(added.body.status).toBe('scheduled');
    expect(edited.body.status).toBe('scheduled');
    expect(
      (await snapshot(flightId)).cabins.map((cabin) => [
        cabin.cabin,
        cabin.price,
      ]),
    ).toEqual([
      ['economy', 1],
      ['business', 150000],
    ]);
  });

  it.each([
    [
      'stored as scheduled, but its departure time has passed',
      { departureAt: new Date(Date.now() - 2 * HOUR_MS) },
    ],
    [
      'stored as scheduled, departed yesterday',
      { departureAt: new Date(Date.now() - DAY_MS) },
    ],
    [
      'stored as cancelled, departing in the future',
      {
        departureAt: new Date(Date.now() + 2 * DAY_MS),
        status: FlightStatus.Cancelled,
      },
    ],
    [
      'stored as cancelled, whose departure time has passed',
      {
        departureAt: new Date(Date.now() - DAY_MS),
        status: FlightStatus.Cancelled,
      },
    ],
    [
      'stored as departed',
      {
        departureAt: new Date(Date.now() - DAY_MS),
        status: FlightStatus.Departed,
      },
    ],
  ])(
    'refuses with 409 to add or edit a cabin of a flight %s, and changes nothing',
    async (_case, options) => {
      const stored = fx.storedCabin();
      const flightId = await fx.insertFlight({ ...options, cabins: [stored] });
      const before = await snapshot(flightId);

      const added = await addCabin(flightId);
      const edited = await editCabin(flightId, stored._id.toString());

      expect([added.status, edited.status]).toEqual([409, 409]);
      expect(added.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
      expect(edited.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
      expect(await snapshot(flightId)).toEqual(before);
    },
  );

  it('answers 409 for a past departure before the class check: no duplicate message', async () => {
    const flightId = await fx.insertFlight({
      departureAt: new Date(Date.now() - DAY_MS),
      cabins: [fx.storedCabin({ cabin: CabinClass.Business })],
    });

    const added = await addCabin(flightId);

    expect(added.status).toBe(409);
    expect(added.body.message).toBe(FLIGHT_NOT_SCHEDULED_MESSAGE);
  });

  it('answers status scheduled when POST /api/flights creates a flight', async () => {
    const date = new Date(Date.now() + 20 * DAY_MS).toISOString().slice(0, 10);

    const response = await fx
      .http()
      .post('/api/flights')
      .set('Cookie', fx.moderator.cookie)
      .send({
        flightNumber: newFlightNumber(),
        departureAirport: fx.airports.departure,
        arrivalAirport: fx.airports.arrival,
        departureLocal: `${date}T10:00`,
        arrivalLocal: `${date}T20:00`,
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('scheduled');
    expect(response.body.cabins).toEqual([]);
  });

  it('never wrote departed for a past flight: the status is derived, the stored one stays', async () => {
    const flightId = await fx.insertFlight({
      departureAt: new Date(Date.now() - DAY_MS),
    });

    await addCabin(flightId);

    expect((await snapshot(flightId)).status).toBe('scheduled');
  });

  it('documents the derived status in Swagger', async () => {
    const document = (await fx.http().get('/api/docs-json').expect(200)).body;
    const status = document.components.schemas.FlightResponseDto.properties
      .status as { description: string };

    expect(status.description).toMatch(/departed/);
    expect(status.description).toMatch(/cancelled flight stays cancelled/);
  });
});
