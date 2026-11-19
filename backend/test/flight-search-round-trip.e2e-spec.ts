import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';
import { RETURN_BEFORE_DEPARTURE_MESSAGE } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import {
  createFlightFixture,
  FIXTURE_ZONES,
  type FlightFixture,
} from './support/flight-fixture';

interface ResultBody {
  id: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDateLocal: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  cabins: { cabin: string; price: number; availableSeats: number }[];
}
interface PageBody {
  items: ResultBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
interface RoundTripBody {
  outbound: PageBody;
  return: PageBody;
}

/**
 * FLT-12(a) and (c): the round-trip search and the cabin filter, on the
 * fixture's own airports and a far-future day unique to this run, so no other
 * suite has flights there.
 */
describe('Flight search: round trip and cabin (e2e, FLT-12)', () => {
  let f: FlightFixture;
  let day0: DateTime;
  /** The ids of this suite's flights, by name. */
  const id: Record<string, string> = {};

  /** `hourUtc` on `day0 + days`, UTC. */
  const at = (days: number, hourUtc: number): Date =>
    day0.plus({ days, hours: hourUtc }).toJSDate();
  const dateOf = (days: number): string =>
    day0.plus({ days }).toFormat('yyyy-MM-dd');

  const search = (query: Record<string, string | number>) =>
    f.http().get('/api/flights/search').query(query);
  const roundTrip = (extra: Record<string, string | number> = {}) => ({
    departureAirport: f.airports.departure,
    arrivalAirport: f.airports.arrival,
    departureDate: dateOf(0),
    returnDate: dateOf(7),
    passengers: 1,
    ...extra,
  });
  const idsOf = (page: PageBody) => page.items.map((item) => item.id);
  const cabinsOf = (page: PageBody) =>
    page.items.map((item) => item.cabins.map((cabin) => cabin.cabin));

  beforeAll(async () => {
    f = await createFlightFixture('flt12s');
    const hash = createHash('sha256').update(f.run).digest().readUInt32BE(0);
    // March to September: New York is UTC-4, Cairo UTC+2 or +3.
    day0 = DateTime.utc(2090 + (hash % 8), 3, 15).plus({ days: hash % 150 });
    const there = {
      departureAirport: f.airports.departure,
      arrivalAirport: f.airports.arrival,
    };
    const back = {
      departureAirport: f.airports.arrival,
      arrivalAirport: f.airports.departure,
    };
    // Outbound on day 0: an economy and business flight, and an economy-only one.
    id.out1 = await f.insertFlight({
      ...there,
      departureAt: at(0, 8),
      cabins: [
        { cabin: CabinClass.Economy, price: 30000 },
        { cabin: CabinClass.Business, price: 90000 },
      ],
    });
    id.out2 = await f.insertFlight({
      ...there,
      departureAt: at(0, 12),
      cabins: [{ cabin: CabinClass.Economy, price: 20000 }],
    });
    // Return on day 7 (New York date): economy and first; business of the
    // other airline; and one leaving at 02:00 UTC on day 8, which is still
    // day 7 in New York (22:00, UTC-4), so it is a day-7 return.
    id.ret1 = await f.insertFlight({
      ...back,
      departureAt: at(7, 14),
      cabins: [
        { cabin: CabinClass.Economy, price: 25000 },
        { cabin: CabinClass.First, price: 300000 },
      ],
    });
    id.ret2 = await f.insertFlight({
      ...back,
      airlineId: f.otherAirlineId,
      departureAt: at(7, 18),
      cabins: [{ cabin: CabinClass.Business, price: 80000 }],
    });
    id.retLateLocal = await f.insertFlight({
      ...back,
      departureAt: at(8, 2),
      cabins: [{ cabin: CabinClass.Economy, price: 15000, totalSeats: 2 }],
    });
    // Not a day-7 return: day 9 in New York.
    id.retOtherDay = await f.insertFlight({
      ...back,
      departureAt: at(9, 14),
      cabins: [{ cabin: CabinClass.Economy, price: 25000 }],
    });
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  it('answers a one-way search (no returnDate) with one page, as before', async () => {
    const { returnDate: _omit, ...oneWay } = roundTrip();
    void _omit;

    const response = await search(oneWay).expect(200);

    const body = response.body as PageBody;
    expect(Object.keys(body).sort()).toEqual(['items', 'meta']);
    expect(idsOf(body)).toEqual([id.out1, id.out2]);
  });

  it('answers a round trip with { outbound, return }: the route on departureDate and the route back on returnDate', async () => {
    const response = await search(roundTrip()).expect(200);

    const body = response.body as RoundTripBody;
    expect(Object.keys(body).sort()).toEqual(['outbound', 'return']);
    expect(idsOf(body.outbound)).toEqual([id.out1, id.out2]);
    expect(body.outbound.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(idsOf(body.return)).toEqual([id.ret1, id.ret2, id.retLateLocal]);
    expect(body.return.meta.total).toBe(3);
    for (const item of body.return.items) {
      expect(item).toMatchObject({
        departureAirport: f.airports.arrival,
        arrivalAirport: f.airports.departure,
        departureDateLocal: dateOf(7),
        departureTimeZone: FIXTURE_ZONES.arrival,
        arrivalTimeZone: FIXTURE_ZONES.departure,
      });
    }
  });

  it('reads returnDate as the local date at the arrival airport, not the UTC date', async () => {
    const day8 = (
      await search(roundTrip({ returnDate: dateOf(8) })).expect(200)
    ).body as RoundTripBody;

    // 02:00 UTC on day 8 is day 7 in New York: listed on day 7, not on day 8.
    expect(idsOf(day8.return)).toEqual([]);
    const day9 = (
      await search(roundTrip({ returnDate: dateOf(9) })).expect(200)
    ).body as RoundTripBody;
    expect(idsOf(day9.return)).toEqual([id.retOtherDay]);
  });

  it('applies the same passengers to both legs', async () => {
    const body = (await search(roundTrip({ passengers: 3 })).expect(200))
      .body as RoundTripBody;

    expect(idsOf(body.outbound)).toEqual([id.out1, id.out2]);
    // The late return has 2 seats: not enough for 3.
    expect(idsOf(body.return)).toEqual([id.ret1, id.ret2]);
  });

  it('applies the same page and limit to both legs', async () => {
    const first = (await search(roundTrip({ limit: 1 })).expect(200))
      .body as RoundTripBody;
    const second = (await search(roundTrip({ limit: 1, page: 2 })).expect(200))
      .body as RoundTripBody;

    expect(first.outbound.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(first.return.meta).toEqual({
      page: 1,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
    expect([...idsOf(first.outbound), ...idsOf(second.outbound)]).toEqual([
      id.out1,
      id.out2,
    ]);
    expect([...idsOf(first.return), ...idsOf(second.return)]).toEqual([
      id.ret1,
      id.ret2,
    ]);
  });

  it('applies the same price range and order to both legs', async () => {
    const body = (
      await search(
        roundTrip({ maxPrice: 30000, sortBy: 'price', sortOrder: 'desc' }),
      ).expect(200)
    ).body as RoundTripBody;

    expect(idsOf(body.outbound)).toEqual([id.out1, id.out2]);
    expect(cabinsOf(body.outbound)).toEqual([['economy'], ['economy']]);
    expect(idsOf(body.return)).toEqual([id.ret1, id.retLateLocal]);
    expect(cabinsOf(body.return)).toEqual([['economy'], ['economy']]);
  });

  it('accepts a return on the departure date: a same-day round trip, with its own pages', async () => {
    const body = (
      await search(roundTrip({ returnDate: dateOf(0) })).expect(200)
    ).body as RoundTripBody;

    expect(idsOf(body.outbound)).toEqual([id.out1, id.out2]);
    expect(body.return).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('refuses a return date before the departure date: 400 on returnDate', async () => {
    const response = await search(roundTrip({ returnDate: dateOf(-1) })).expect(
      400,
    );

    // The project error shape (also error, path and timestamp).
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        { field: 'returnDate', messages: [RETURN_BEFORE_DEPARTURE_MESSAGE] },
      ],
    });
  });

  it.each([
    ['2090-02-30', 'returnDate must be a real calendar date'],
    ['22-06-2090', 'returnDate must be a date YYYY-MM-DD'],
    ['', 'returnDate must be a date YYYY-MM-DD'],
  ])('refuses the return date %p', async (returnDate, message) => {
    const response = await search(roundTrip({ returnDate })).expect(400);

    expect(response.body.errors).toEqual([
      { field: 'returnDate', messages: expect.arrayContaining([message]) },
    ]);
  });

  describe('cabin filter (c)', () => {
    it('lists only flights with that cabin, and only that cabin, one-way', async () => {
      const { returnDate: _omit, ...oneWay } = roundTrip({ cabin: 'business' });
      void _omit;

      const body = (await search(oneWay).expect(200)).body as PageBody;

      expect(idsOf(body)).toEqual([id.out1]);
      expect(cabinsOf(body)).toEqual([['business']]);
      expect(body.items[0].cabins[0].price).toBe(90000);
    });

    it('filters both legs of a round trip', async () => {
      const business = (
        await search(roundTrip({ cabin: 'business' })).expect(200)
      ).body as RoundTripBody;
      const first = (await search(roundTrip({ cabin: 'first' })).expect(200))
        .body as RoundTripBody;

      expect(idsOf(business.outbound)).toEqual([id.out1]);
      expect(idsOf(business.return)).toEqual([id.ret2]);
      expect(cabinsOf(business.return)).toEqual([['business']]);
      // No outbound flight has a first cabin: an empty page, not an error.
      expect(first.outbound.meta.total).toBe(0);
      expect(idsOf(first.return)).toEqual([id.ret1]);
      expect(cabinsOf(first.return)).toEqual([['first']]);
    });

    it('still asks for enough seats in that cabin', async () => {
      const { returnDate: _omit, ...oneWay } = roundTrip();
      void _omit;
      await f.flights
        .updateOne({ _id: id.out2 }, { $set: { 'cabins.0.bookedSeats': 99 } })
        .exec();
      try {
        const body = (
          await search({ ...oneWay, cabin: 'economy', passengers: 2 }).expect(
            200,
          )
        ).body as PageBody;
        expect(idsOf(body)).toEqual([id.out1]);
      } finally {
        await f.flights
          .updateOne({ _id: id.out2 }, { $set: { 'cabins.0.bookedSeats': 0 } })
          .exec();
      }
    });

    it.each(['Economy', 'coach', ''])(
      'refuses the cabin %p, naming every cabin',
      async (cabin) => {
        const response = await search(roundTrip({ cabin })).expect(400);

        expect(response.body.errors).toEqual([
          {
            field: 'cabin',
            messages: [
              'cabin must be one of: economy, premium_economy, business, first',
            ],
          },
        ]);
      },
    );
  });

  it('only reads: no flight changes', async () => {
    const before = await f.flights
      .find({ _id: { $in: Object.values(id) } })
      .sort({ _id: 1 })
      .lean()
      .exec();

    await search(roundTrip({ cabin: 'economy' })).expect(200);

    const after = await f.flights
      .find({ _id: { $in: Object.values(id) } })
      .sort({ _id: 1 })
      .lean()
      .exec();
    expect(after).toEqual(before);
  });

  it('documents returnDate and cabin as optional with no example, and both answers in Swagger', async () => {
    const response = await f.http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/flights/search'].get as {
      summary: string;
      description: string;
      parameters: {
        name: string;
        required: boolean;
        example?: unknown;
        schema?: { example?: unknown; enum?: string[] };
      }[];
      responses: Record<
        string,
        { content: { 'application/json': { schema: { oneOf: unknown[] } } } }
      >;
    };
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    const parameter = (name: string) =>
      operation.parameters.find((item) => item.name === name);

    expect(operation.summary).toContain('FLT-12');
    expect(operation.description).toContain('FLT-12(a)');
    expect(operation.description).toContain('FLT-12(c)');
    for (const name of ['returnDate', 'cabin']) {
      expect(parameter(name)).toMatchObject({ required: false });
      expect(parameter(name)?.example).toBeUndefined();
      expect(parameter(name)?.schema?.example).toBeUndefined();
    }
    expect(
      operation.responses['200'].content['application/json'].schema.oneOf,
    ).toHaveLength(2);
    expect(
      Object.keys(schemas.RoundTripSearchResponseDto.properties).sort(),
    ).toEqual(['outbound', 'return']);
  });
});
