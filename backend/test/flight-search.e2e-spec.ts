import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import type { Model } from 'mongoose';
import { createHash, randomInt } from 'node:crypto';
import { FLIGHT_SEARCH_PASSENGERS_MAX } from './../src/flights/flights.constants';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { Airport } from './../src/reference/models/airport.schema';
import {
  createFlightFixture,
  type FlightFixture,
  type StoredCabin,
} from './support/flight-fixture';

interface CabinBody {
  id: string;
  cabin: string;
  price: number;
  currency: string;
  availableSeats: number;
  freeBags: number;
  maxBagKg: number;
}
interface ResultBody {
  id: string;
  airlineId: string;
  flightNumber: string;
  departureAt: string;
  departureDateLocal: string;
  departureLocal: string;
  status: string;
  airline: { id: string; name: string; code: string; logoUrl: string };
  cabins: CabinBody[];
}
interface PageBody {
  items: ResultBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
interface SwaggerProperty {
  description?: string;
  example?: unknown;
}

describe('Flight search (e2e, FLT-11)', () => {
  let f: FlightFixture;
  let airports: Model<Airport>;
  /** A day far ahead, unique to this run, so no other suite has flights on it. */
  let day0: DateTime;

  /** 10:00 UTC on `day0 + days`: the same date in Cairo (UTC+2 or +3). */
  const at = (days: number, hourUtc = 10, minute = 0): Date =>
    day0.plus({ days, hours: hourUtc, minutes: minute }).toJSDate();
  const dateOf = (days: number): string =>
    day0.plus({ days }).toFormat('yyyy-MM-dd');

  const search = (query: Record<string, string | number>, cookie?: string) => {
    const call = f.http().get('/api/flights/search').query(query);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const route = (
    date: string,
    passengers: number | string = 1,
    extra: Record<string, string | number> = {},
  ) => ({
    departureAirport: f.airports.departure,
    arrivalAirport: f.airports.arrival,
    departureDate: date,
    passengers,
    ...extra,
  });
  const idsOf = (body: PageBody) => body.items.map((item) => item.id);
  const economy = (fields: StoredCabin = {}): StoredCabin => ({
    cabin: CabinClass.Economy,
    ...fields,
  });

  beforeAll(async () => {
    f = await createFlightFixture('flt11');
    airports = f.app.get<Model<Airport>>(getModelToken(Airport.name));
    const hash = createHash('sha256').update(f.run).digest().readUInt32BE(0);
    day0 = DateTime.utc(2090 + (hash % 8), 1, 1).plus({ days: hash % 300 });
  });

  afterAll(async () => {
    await f.cleanup();
  });

  describe('a match', () => {
    let flightId: string;

    beforeAll(async () => {
      flightId = await f.insertFlight({
        departureAt: at(0),
        cabins: [
          economy({ totalSeats: 100, bookedSeats: 10, heldSeats: 5 }),
          { cabin: CabinClass.Business, totalSeats: 20, price: 90000 },
        ],
      });
    });

    it('is listed for a guest, with the flight, its airline, its local times and the cabins to choose', async () => {
      const response = await search(route(dateOf(0), 2)).expect(200);
      const body = response.body as PageBody;
      const flight = await f.flights.findById(flightId).lean().orFail();
      const airline = await f.airlines.findById(f.airlineId).lean().orFail();

      expect(idsOf(body)).toEqual([flightId]);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      const [result] = body.items;
      expect(Object.keys(result).sort()).toEqual(
        [
          'id',
          'airlineId',
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
          'createdAt',
          'updatedAt',
          'airline',
          'cabins',
        ].sort(),
      );
      expect(result).toMatchObject({
        airlineId: f.airlineId,
        flightNumber: flight.flightNumber,
        departureAt: flight.departureAt.toISOString(),
        departureDateLocal: dateOf(0),
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'America/New_York',
        status: 'scheduled',
        airline: {
          id: f.airlineId,
          name: airline.name,
          code: airline.code,
          logoUrl: `/api/uploads/${airline.logo}`,
        },
      });
      expect(result.departureAt).toMatch(/Z$/);
      expect(result.departureLocal).toBe(
        DateTime.fromJSDate(flight.departureAt, {
          zone: 'Africa/Cairo',
        }).toFormat("yyyy-MM-dd'T'HH:mm"),
      );
      expect(result.cabins).toEqual(
        flight.cabins.map((cabin) => ({
          id: cabin._id.toString(),
          cabin: cabin.cabin,
          price: cabin.price,
          currency: 'USD',
          availableSeats:
            cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
          freeBags: cabin.freeBags,
          maxBagKg: cabin.maxBagKg,
        })),
      );
      const text = JSON.stringify(body);
      for (const internal of [
        'bookedSeats',
        'heldSeats',
        'totalSeats',
        '_id',
        '__v',
      ]) {
        expect(text).not.toContain(internal);
      }
    });

    it('gives a logged-in user, of any role, the same answer as a guest', async () => {
      const guest = await search(route(dateOf(0), 2)).expect(200);

      for (const actor of [
        f.user,
        f.moderator,
        f.otherModerator,
        f.hotelModerator,
        f.admin,
      ]) {
        const response = await search(route(dateOf(0), 2), actor.cookie).expect(
          200,
        );
        expect(response.body).toEqual(guest.body);
      }
    });

    it('finds nothing when one criterion differs', async () => {
      const elsewhere = await f.createAirport('Africa/Cairo', 'EG');

      for (const query of [
        route(dateOf(0), 2, { departureAirport: elsewhere }),
        route(dateOf(0), 2, { arrivalAirport: elsewhere }),
        route(dateOf(0), 2, {
          departureAirport: f.airports.arrival,
          arrivalAirport: f.airports.departure,
        }),
        route(dateOf(-1), 2),
        route(dateOf(1), 2),
      ]) {
        const response = await search(query).expect(200);
        expect(idsOf(response.body as PageBody)).not.toContain(flightId);
        expect((response.body as PageBody).items).toEqual([]);
      }
    });

    it('trims and uppercases the airport codes', async () => {
      const response = await search(
        route(dateOf(0), 2, {
          departureAirport: ` ${f.airports.departure.toLowerCase()} `,
          arrivalAirport: f.airports.arrival.toLowerCase(),
        }),
      ).expect(200);

      expect(idsOf(response.body as PageBody)).toEqual([flightId]);
    });
  });

  it('searches by the local date at the departure airport, not the UTC date', async () => {
    // Singapore is UTC+8: 20:00 UTC is 04:00 the next day there.
    const singapore = await f.createAirport('Asia/Singapore', 'SG');
    const flightId = await f.insertFlight({
      departureAirport: singapore,
      departureAt: at(10, 20),
      cabins: [economy()],
    });
    const query = (date: string) =>
      route(date, 1, { departureAirport: singapore });

    const localDate = await search(query(dateOf(11))).expect(200);
    const utcDate = await search(query(dateOf(10))).expect(200);

    expect(idsOf(localDate.body as PageBody)).toEqual([flightId]);
    expect((localDate.body as PageBody).items[0]).toMatchObject({
      departureDateLocal: dateOf(11),
      departureLocal: `${dateOf(11)}T04:00`,
      departureUtcOffset: '+08:00',
    });
    expect(idsOf(utcDate.body as PageBody)).toEqual([]);
  });

  describe('only scheduled flights that have not departed (FLT-30)', () => {
    it('leaves out cancelled and departed flights', async () => {
      const scheduled = await f.insertFlight({
        departureAt: at(20, 8),
        cabins: [economy()],
      });
      await f.insertFlight({
        departureAt: at(20, 9),
        status: FlightStatus.Cancelled,
        cabins: [economy()],
      });
      await f.insertFlight({
        departureAt: at(20, 10),
        status: FlightStatus.Departed,
        cabins: [economy()],
      });

      const response = await search(route(dateOf(20))).expect(200);

      expect(idsOf(response.body as PageBody)).toEqual([scheduled]);
    });

    it('leaves out a flight still stored as scheduled whose departure has passed', async () => {
      // An airport where it is daytime now, so 5 minutes before and after
      // now fall on the same local date.
      const hour = new Date().getUTCHours();
      const offset = [...Array(26).keys()]
        .map((index) => index - 11)
        .find((candidate) => {
          const local = (((hour + candidate) % 24) + 24) % 24;
          return local >= 6 && local <= 17;
        }) as number;
      const zone =
        offset === 0
          ? 'Etc/GMT'
          : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      const daytime = await f.createAirport(zone, 'XX');
      const now = Date.now();
      const passed = await f.insertFlight({
        departureAirport: daytime,
        departureAt: new Date(now - 5 * 60_000),
        cabins: [economy()],
      });
      const coming = await f.insertFlight({
        departureAirport: daytime,
        departureAt: new Date(now + 5 * 60_000),
        cabins: [economy()],
      });
      const today = DateTime.fromMillis(now, { zone }).toFormat('yyyy-MM-dd');
      expect(
        (await f.flights.findById(passed).lean().orFail()).departureDateLocal,
      ).toBe(today);

      const response = await search(
        route(today, 1, { departureAirport: daytime }),
      ).expect(200);

      expect(idsOf(response.body as PageBody)).toEqual([coming]);
    });
  });

  describe('only flights of active airlines (ACC-15)', () => {
    let flightId: string;
    const query = () => route(dateOf(30));

    beforeAll(async () => {
      flightId = await f.insertFlight({
        airlineId: f.otherAirlineId,
        departureAt: at(30),
        cabins: [economy()],
      });
    });

    afterAll(async () => {
      await f.airlines.updateOne(
        { _id: f.otherAirlineId },
        { $set: { active: true } },
      );
    });

    it('leaves out a deactivated airline and lists it again once reactivated', async () => {
      await f.airlines.updateOne(
        { _id: f.otherAirlineId },
        { $set: { active: false } },
      );
      expect(
        idsOf((await search(query()).expect(200)).body as PageBody),
      ).toEqual([]);

      await f.airlines.updateOne(
        { _id: f.otherAirlineId },
        { $set: { active: true } },
      );
      expect(
        idsOf((await search(query()).expect(200)).body as PageBody),
      ).toEqual([flightId]);
    });

    it('counts an airline stored without the field as active', async () => {
      await f.airlines.collection.updateOne(
        { _id: (await f.airlines.findById(f.otherAirlineId).orFail())._id },
        { $unset: { active: '' } },
      );

      expect(
        idsOf((await search(query()).expect(200)).body as PageBody),
      ).toEqual([flightId]);
    });
  });

  describe('enough seats: total - booked - held >= passengers', () => {
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      // Each flight 1 hour after the previous one, so the order is known.
      ids.equal = await f.insertFlight({
        departureAt: at(40, 6),
        cabins: [economy({ totalSeats: 10, bookedSeats: 3, heldSeats: 2 })],
      });
      ids.short = await f.insertFlight({
        departureAt: at(40, 7),
        cabins: [
          economy({ totalSeats: 10, bookedSeats: 6, heldSeats: 0 }),
          {
            cabin: CabinClass.Business,
            totalSeats: 10,
            bookedSeats: 0,
            heldSeats: 6,
          },
        ],
      });
      ids.mixed = await f.insertFlight({
        departureAt: at(40, 8),
        cabins: [
          economy({ totalSeats: 10, bookedSeats: 8, heldSeats: 0 }),
          {
            cabin: CabinClass.Business,
            totalSeats: 10,
            bookedSeats: 2,
            heldSeats: 2,
          },
        ],
      });
      ids.noCabins = await f.insertFlight({ departureAt: at(40, 9) });
      ids.full = await f.insertFlight({
        departureAt: at(40, 10),
        cabins: [economy({ totalSeats: 10, bookedSeats: 5, heldSeats: 5 })],
      });
    });

    it('lists a cabin with exactly as many seats as passengers, and only the cabins that fit', async () => {
      const response = await search(route(dateOf(40), 5)).expect(200);
      const body = response.body as PageBody;

      expect(idsOf(body)).toEqual([ids.equal, ids.mixed]);
      expect(body.items[0].cabins.map((cabin) => cabin.availableSeats)).toEqual(
        [5],
      );
      expect(body.items[1].cabins).toHaveLength(1);
      expect(body.items[1].cabins[0]).toMatchObject({
        cabin: 'business',
        availableSeats: 6,
      });
    });

    it('leaves out a flight one seat short in every cabin, booked and held both counted', async () => {
      const six = await search(route(dateOf(40), 6)).expect(200);
      const four = await search(route(dateOf(40), 4)).expect(200);

      expect(idsOf(six.body as PageBody)).toEqual([ids.mixed]);
      expect(idsOf(four.body as PageBody)).toEqual([
        ids.equal,
        ids.short,
        ids.mixed,
      ]);
      // With 4 passengers, both cabins of "short" fit (4 left each).
      expect((four.body as PageBody).items[1].cabins).toHaveLength(2);
    });

    it('never lists a flight with no cabin, or a full one', async () => {
      const response = await search(route(dateOf(40), 1)).expect(200);

      expect(idsOf(response.body as PageBody)).not.toContain(ids.noCabins);
      expect(idsOf(response.body as PageBody)).not.toContain(ids.full);
    });

    it('changes no counter and no flight: the search only reads', async () => {
      const before = await f.flights
        .find({ _id: { $in: Object.values(ids) } })
        .sort({ _id: 1 })
        .lean();

      await search(route(dateOf(40), 5)).expect(200);
      await search(route(dateOf(40), 1)).expect(200);

      const after = await f.flights
        .find({ _id: { $in: Object.values(ids) } })
        .sort({ _id: 1 })
        .lean();
      expect(after).toEqual(before);
    });
  });

  describe('no match: 200 with an empty page', () => {
    it.each([
      ['a date with no flight', () => dateOf(50)],
      ['a date in the past', () => '2020-01-01'],
      ['a date far ahead', () => '2199-12-31'],
    ])('answers %s with no flights found', async (_label, date) => {
      const response = await search(route(date())).expect(200);

      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('order and pages', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      // Two flights at the same minute: the id decides between them.
      ids.push(
        await f.insertFlight({ departureAt: at(60, 9), cabins: [economy()] }),
      );
      ids.push(
        await f.insertFlight({ departureAt: at(60, 9), cabins: [economy()] }),
      );
      ids.push(
        await f.insertFlight({ departureAt: at(60, 7), cabins: [economy()] }),
      );
    });

    it('orders by departure time, then id, and counts every match', async () => {
      const response = await search(route(dateOf(60))).expect(200);
      const body = response.body as PageBody;
      const [first, second] = [ids[0], ids[1]].sort();

      expect(idsOf(body)).toEqual([ids[2], first, second]);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('gives one flight per page with limit 1, and the right total', async () => {
      const all = idsOf(
        (await search(route(dateOf(60))).expect(200)).body as PageBody,
      );

      for (const page of [1, 2, 3]) {
        const response = await search(
          route(dateOf(60), 1, { page, limit: 1 }),
        ).expect(200);
        expect(response.body).toMatchObject({
          meta: { page, limit: 1, total: 3, totalPages: 3 },
        });
        expect(idsOf(response.body as PageBody)).toEqual([all[page - 1]]);
      }
      const past = await search(
        route(dateOf(60), 1, { page: 4, limit: 1 }),
      ).expect(200);
      expect(past.body).toEqual({
        items: [],
        meta: { page: 4, limit: 1, total: 3, totalPages: 3 },
      });
    });
  });

  describe('400 in the project error shape', () => {
    /** A well-formed code that no airport has: not official, not in the test database. */
    const unknownCode = async (): Promise<string> => {
      for (;;) {
        const code = Array.from({ length: 3 }, () =>
          String.fromCharCode(65 + randomInt(26)),
        ).join('');
        if (!(await airports.exists({ _id: code }))) return code;
      }
    };

    const refused = async (
      query: Record<string, string | number>,
      field: string,
    ) => {
      const response = await search(query).expect(400);
      expect(response.body.message).toBe('Validation failed');
      expect(
        response.body.errors.map((error: { field: string }) => error.field),
      ).toEqual([field]);
      return response.body.errors[0].messages as string[];
    };

    it.each([
      ['departureAirport', 'departureAirport is required'],
      ['arrivalAirport', 'arrivalAirport is required'],
      ['departureDate', 'departureDate is required'],
      ['passengers', 'passengers is required'],
    ])('refuses a search without %s', async (field, message) => {
      const query: Record<string, string | number> = route(dateOf(0));
      delete query[field];

      expect((await refused(query, field))[0]).toBe(message);
    });

    it.each([
      ['departureAirport', 'CA'],
      ['departureAirport', 'CAIR'],
      ['arrivalAirport', 'J1K'],
    ])('refuses %s %p, which is not 3 letters', async (field, code) => {
      expect(
        await refused(route(dateOf(0), 1, { [field]: code }), field),
      ).toContain(`${field} must be a 3-letter IATA airport code`);
    });

    it('refuses a well-formed airport code that is not in the airports list, as FLT-03 does', async () => {
      const code = await unknownCode();

      expect(
        await refused(
          route(dateOf(0), 1, { departureAirport: code }),
          'departureAirport',
        ),
      ).toEqual([`departureAirport ${code} is not in the airports list`]);
      expect(
        await refused(
          route(dateOf(0), 1, { arrivalAirport: code }),
          'arrivalAirport',
        ),
      ).toEqual([`arrivalAirport ${code} is not in the airports list`]);
    });

    it('refuses the same airport twice', async () => {
      expect(
        await refused(
          route(dateOf(0), 1, { arrivalAirport: f.airports.departure }),
          'arrivalAirport',
        ),
      ).toEqual(['arrivalAirport must be different from departureAirport']);
    });

    it.each([
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '15-06-2027',
      '2027-06-15T10:00',
    ])('refuses the date %p', async (departureDate) => {
      await refused(route(departureDate), 'departureDate');
    });

    it.each([
      '0',
      '-1',
      '1.5',
      'two',
      String(FLIGHT_SEARCH_PASSENGERS_MAX + 1),
    ])('refuses %p passengers', async (passengers) => {
      await refused(route(dateOf(0), passengers), 'passengers');
    });

    it.each([
      ['page', '0'],
      ['limit', '0'],
      ['limit', '51'],
    ])('refuses %s %p', async (field, value) => {
      await refused(route(dateOf(0), 1, { [field]: value }), field);
    });

    it('refuses a page so large that the database could not skip to it', async () => {
      expect(
        await refused(route(dateOf(0), 1, { page: '1e20' }), 'page'),
      ).toEqual(['page is too large']);
    });

    it('refuses skip, which the server computes from page and limit: 400, not a crash', async () => {
      expect(
        await refused(route(dateOf(0), 1, { page: '2', skip: '5' }), 'skip'),
      ).toEqual(['property skip should not exist']);
    });

    it('reports a sent skip in the same 400 as another unknown parameter', async () => {
      const response = await search(
        route(dateOf(0), 1, { skip: '5', cabin: 'economy' }),
      ).expect(400);

      expect(
        response.body.errors
          .map((error: { field: string }) => error.field)
          .sort(),
      ).toEqual(['cabin', 'skip']);
    });

    it.each(['returnDate', 'cabin', 'maxPrice', 'sort'])(
      'refuses the parameter %s, which this search does not have',
      async (field) => {
        expect(
          await refused(route(dateOf(0), 1, { [field]: 'x' }), field),
        ).toEqual([`property ${field} should not exist`]);
      },
    );
  });

  it('documents the search in Swagger: public, its parameters, a paginated result', async () => {
    const response = await f.http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/flights/search'].get as {
      tags: string[];
      description: string;
      security?: unknown[];
      parameters: { name: string; required: boolean }[];
      responses: Record<string, unknown>;
    };
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, SwaggerProperty> }
    >;

    expect(operation.tags).toEqual(['Flights']);
    expect(operation.description).toMatch(/^FLT-11\. /);
    expect(operation.description).toContain('empty page');
    expect(operation.security ?? []).toEqual([]);
    // No `pattern`: Swagger UI would refuse " cai " and lower case, which the
    // API accepts (trimmed and uppercased).
    for (const parameter of operation.parameters as {
      schema?: { pattern?: string };
    }[]) {
      expect(parameter.schema?.pattern).toBeUndefined();
    }
    expect(
      Object.fromEntries(operation.parameters.map((p) => [p.name, p.required])),
    ).toEqual({
      page: false,
      limit: false,
      departureAirport: true,
      arrivalAirport: true,
      departureDate: true,
      passengers: true,
    });
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
    for (const name of [
      'FlightSearchResultResponseDto',
      'FlightSearchCabinResponseDto',
      'FlightSearchAirlineResponseDto',
    ]) {
      for (const [field, property] of Object.entries(
        schemas[name].properties,
      )) {
        if (field === 'airline' || field === 'cabins' || field === 'status') {
          continue;
        }
        expect({ field, example: property.example !== undefined }).toEqual({
          field,
          example: true,
        });
      }
    }
    expect(
      Object.keys(schemas.FlightSearchCabinResponseDto.properties).sort(),
    ).toEqual([
      'availableSeats',
      'cabin',
      'currency',
      'freeBags',
      'id',
      'maxBagKg',
      'price',
    ]);
  });
});
