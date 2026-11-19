import './support/auth-env';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import {
  createFlightFixture,
  FIXTURE_ZONES,
  type FlightFixture,
  newFlightNumber,
} from './support/flight-fixture';

/**
 * Next year, so the flights below are always in the future (FLT-03). The
 * offsets of mid-January and mid-July do not change from year to year.
 */
const YEAR = new Date().getUTCFullYear() + 1;

/** The six local-time fields of a flight response (GEN-06). */
const LOCAL_FIELDS = [
  'departureLocal',
  'departureTimeZone',
  'departureUtcOffset',
  'arrivalLocal',
  'arrivalTimeZone',
  'arrivalUtcOffset',
] as const;

describe('Local flight times (e2e, GEN-06)', () => {
  let fx: FlightFixture;

  const createFlight = (departureLocal: string, arrivalLocal: string) =>
    fx.http().post('/api/flights').set('Cookie', fx.moderator.cookie).send({
      flightNumber: newFlightNumber(),
      departureAirport: fx.airports.departure,
      arrivalAirport: fx.airports.arrival,
      departureLocal,
      arrivalLocal,
    });

  beforeAll(async () => {
    fx = await createFlightFixture('gen06');
  });

  afterAll(async () => {
    // fx is unset when the fixture failed; it then cleaned up after itself.
    await fx?.cleanup();
  });

  it('answers a new flight with each time at its own airport, as typed, and the UTC moments unchanged', async () => {
    const response = await createFlight(
      `${YEAR}-01-15T10:00`,
      `${YEAR}-01-15T15:00`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      departureAt: `${YEAR}-01-15T08:00:00.000Z`,
      arrivalAt: `${YEAR}-01-15T20:00:00.000Z`,
      departureLocal: `${YEAR}-01-15T10:00`,
      departureTimeZone: FIXTURE_ZONES.departure,
      departureUtcOffset: '+02:00',
      arrivalLocal: `${YEAR}-01-15T15:00`,
      arrivalTimeZone: FIXTURE_ZONES.arrival,
      arrivalUtcOffset: '-05:00',
      departureDateLocal: `${YEAR}-01-15`,
    });

    // The database keeps UTC only: nothing local is stored.
    const stored = await fx.flights
      .findById(response.body.id)
      .lean()
      .orFail()
      .exec();
    expect(stored.departureAt.toISOString()).toBe(
      `${YEAR}-01-15T08:00:00.000Z`,
    );
    for (const field of LOCAL_FIELDS) {
      expect(stored).not.toHaveProperty(field);
    }
  });

  it('gives the offset at that moment: New York in July is on daylight saving time', async () => {
    const response = await createFlight(
      `${YEAR}-07-15T10:00`,
      `${YEAR}-07-15T15:00`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      departureLocal: `${YEAR}-07-15T10:00`,
      departureTimeZone: FIXTURE_ZONES.departure,
      arrivalLocal: `${YEAR}-07-15T15:00`,
      arrivalTimeZone: FIXTURE_ZONES.arrival,
      arrivalUtcOffset: '-04:00',
      arrivalAt: `${YEAR}-07-15T19:00:00.000Z`,
    });
  });

  it('answers the same local times after a cabin is added (FLT-04)', async () => {
    const created = await createFlight(
      `${YEAR}-01-20T10:00`,
      `${YEAR}-01-20T15:00`,
    );
    expect(created.status).toBe(201);

    const response = await fx
      .http()
      .post(`/api/flights/${created.body.id}/cabins`)
      .set('Cookie', fx.moderator.cookie)
      .send({
        cabin: CabinClass.Economy,
        totalSeats: 180,
        price: 25000,
        freeBags: 1,
        maxBagKg: 23,
      });

    expect(response.status).toBe(201);
    expect(response.body.cabins).toHaveLength(1);
    for (const field of LOCAL_FIELDS) {
      expect(response.body[field]).toBe(created.body[field]);
    }
    expect(response.body).toMatchObject({
      departureLocal: `${YEAR}-01-20T10:00`,
      departureUtcOffset: '+02:00',
      arrivalLocal: `${YEAR}-01-20T15:00`,
      arrivalUtcOffset: '-05:00',
    });
  });

  it('documents the six local-time fields on FlightResponseDto in Swagger', async () => {
    const response = await fx.http().get('/api/docs-json').expect(200);
    const schema = response.body.components.schemas.FlightResponseDto as {
      properties: Record<string, { type?: string; example?: string }>;
      required?: string[];
    };

    for (const field of LOCAL_FIELDS) {
      expect(schema.properties[field]).toMatchObject({ type: 'string' });
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.departureLocal.example).toBe('2027-01-15T10:00');
    expect(schema.properties.arrivalTimeZone.example).toBe('America/New_York');
  });
});
