import { BadRequestException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import type { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import type { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import { PRICE_RANGE_MESSAGE } from './flights.constants';
import type { FlightResponsesService } from './flight-responses.service';
import {
  crossFieldErrors,
  FlightSearchService,
  outboundLeg,
} from './flight-search.service';
import type { FlightSearchSource } from './mappers/flight-search.mapper';
import type { Airline } from './models/airline.schema';
import { CabinClass } from './models/cabin-class.enum';
import { FlightStatus } from './models/flight-status.enum';
import type { Flight } from './models/flight.schema';

const NOW = new Date('2027-06-01T09:00:00.000Z');
const ZONES = new Map([
  ['CAI', 'Africa/Cairo'],
  ['JFK', 'America/New_York'],
]);

const query = (change: Partial<SearchFlightsQueryDto> = {}) =>
  ({
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureDate: '2027-06-15',
    passengers: 2,
    page: 1,
    limit: 10,
    skip: 0,
    ...change,
  }) as SearchFlightsQueryDto;

const found = (flightNumber: string): FlightSearchSource => ({
  _id: new Types.ObjectId(),
  airlineId: new Types.ObjectId(),
  flightNumber,
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
  createdAt: NOW,
  updatedAt: NOW,
  fittingCabins: [
    {
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
      totalSeats: 10,
      bookedSeats: 6,
      heldSeats: 2,
      price: 25000,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  airline: {
    _id: new Types.ObjectId(),
    name: 'EgyptAir',
    code: 'MS',
    logo: 'logo.png',
  },
});

/** A one-way search answers one page; fails the test on a round-trip answer. */
function onePage(
  result: Awaited<ReturnType<FlightSearchService['search']>>,
): PaginatedResponse<FlightSearchResultResponseDto> {
  if (!('items' in result)) {
    throw new Error('Expected one page, got a round-trip answer');
  }
  return result;
}

function setup(page: unknown = [{ items: [], total: [] }], zones = ZONES) {
  const exec = jest.fn().mockResolvedValue(page);
  const flights = {
    aggregate: jest.fn(() => ({ exec })),
    // Every write a model has: the search must call none of them.
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    bulkWrite: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };
  const airlines = { collection: { collectionName: 'airlines' } };
  const responses = { timeZonesOf: jest.fn().mockResolvedValue(zones) };
  const service = new FlightSearchService(
    flights as unknown as Model<Flight>,
    airlines as unknown as Model<Airline>,
    responses as unknown as FlightResponsesService,
  );
  return { service, flights, responses, exec };
}

describe('FlightSearchService (FLT-11)', () => {
  describe('the query', () => {
    it('is one aggregation: route, local date and scheduled, then the seats, the active airline and the page', () => {
      const { service } = setup();

      expect(service.pipeline(query(), NOW)).toEqual([
        {
          $match: {
            departureAirport: 'CAI',
            arrivalAirport: 'JFK',
            departureDateLocal: '2027-06-15',
            status: FlightStatus.Scheduled,
            departureAt: { $gt: NOW },
          },
        },
        {
          $addFields: {
            fittingCabins: {
              $filter: {
                input: { $ifNull: ['$cabins', []] },
                as: 'cabin',
                cond: {
                  $gte: [
                    {
                      $subtract: [
                        '$$cabin.totalSeats',
                        { $add: ['$$cabin.bookedSeats', '$$cabin.heldSeats'] },
                      ],
                    },
                    2,
                  ],
                },
              },
            },
          },
        },
        { $match: { 'fittingCabins.0': { $exists: true } } },
        {
          $lookup: {
            from: 'airlines',
            localField: 'airlineId',
            foreignField: '_id',
            pipeline: [
              { $match: { active: { $ne: false } } },
              { $project: { name: 1, code: 1, logo: 1 } },
            ],
            as: 'airline',
          },
        },
        { $unwind: '$airline' },
        {
          $facet: {
            items: [
              { $sort: { departureAt: 1, _id: 1 } },
              { $skip: 0 },
              { $limit: 10 },
              { $project: { cabins: 0, __v: 0 } },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ]);
    });

    it('compares the date as the stored local date, with no time zone arithmetic', () => {
      const { service } = setup();
      const [first] = service.pipeline(
        query({ departureDate: '2027-12-31' }),
        NOW,
      ) as [{ $match: Record<string, unknown> }];

      expect(first.$match.departureDateLocal).toBe('2027-12-31');
      expect(first.$match).not.toHaveProperty('departureAt.$lt');
    });

    it('pages in the database: skip and limit come from the page asked for', () => {
      const { service } = setup();
      const stages = service.pipeline(
        query({ page: 3, limit: 5, skip: 10 }),
        NOW,
      );
      const facet = stages[stages.length - 1] as unknown as {
        $facet: { items: Record<string, unknown>[] };
      };

      expect(facet.$facet.items).toContainEqual({ $skip: 10 });
      expect(facet.$facet.items).toContainEqual({ $limit: 5 });
    });

    it('asks for the number of passengers in the seat rule', () => {
      const { service } = setup();
      const text = JSON.stringify(
        service.pipeline(query({ passengers: 7 }), NOW),
      );

      expect(text).toContain('"$$cabin.heldSeats"]}]},7]');
    });

    it('runs one aggregation and writes nothing', async () => {
      const { service, flights } = setup();

      await service.search(query(), NOW);

      for (const write of [
        flights.updateOne,
        flights.updateMany,
        flights.findOneAndUpdate,
        flights.findByIdAndUpdate,
        flights.bulkWrite,
        flights.create,
        flights.deleteOne,
      ]) {
        expect(write).not.toHaveBeenCalled();
      }
      expect(flights.aggregate).toHaveBeenCalledTimes(1);
      expect(flights.aggregate).toHaveBeenCalledWith(
        service.pipeline(query(), NOW),
      );
    });
  });

  describe('the seat rule: the condition the pipeline sends, evaluated for one cabin', () => {
    type Expression = number | string | { [operator: string]: Expression[] };

    /** Evaluates the operators the condition uses, as MongoDB does. */
    const evaluate = (
      expression: Expression,
      cabin: Record<string, number>,
    ): number | boolean => {
      if (typeof expression === 'number') return expression;
      if (typeof expression === 'string') {
        return cabin[expression.replace('$$cabin.', '')];
      }
      const [operator, args] = Object.entries(expression)[0];
      const values = args.map((arg) => evaluate(arg, cabin) as number);
      if (operator === '$gte') return values[0] >= values[1];
      if (operator === '$subtract') return values[0] - values[1];
      if (operator === '$add')
        return values.reduce((sum, value) => sum + value, 0);
      throw new Error(`Unexpected operator ${operator}`);
    };

    const fits = (
      cabin: { totalSeats: number; bookedSeats: number; heldSeats: number },
      passengers: number,
    ) => {
      const { service } = setup();
      const stage = service.pipeline(
        query({ passengers }),
        NOW,
      )[1] as unknown as {
        $addFields: { fittingCabins: { $filter: { cond: Expression } } };
      };
      return evaluate(stage.$addFields.fittingCabins.$filter.cond, cabin);
    };

    it('equal seats fit, one seat short does not, one more fits', () => {
      const cabin = { totalSeats: 10, bookedSeats: 3, heldSeats: 2 };

      expect(fits(cabin, 5)).toBe(true);
      expect(fits(cabin, 6)).toBe(false);
      expect(fits(cabin, 4)).toBe(true);
    });

    it('counts booked and held seats both', () => {
      expect(fits({ totalSeats: 10, bookedSeats: 9, heldSeats: 0 }, 2)).toBe(
        false,
      );
      expect(fits({ totalSeats: 10, bookedSeats: 0, heldSeats: 9 }, 2)).toBe(
        false,
      );
      expect(fits({ totalSeats: 10, bookedSeats: 0, heldSeats: 0 }, 2)).toBe(
        true,
      );
    });

    it('never fits a full cabin', () => {
      expect(fits({ totalSeats: 4, bookedSeats: 2, heldSeats: 2 }, 1)).toBe(
        false,
      );
    });
  });

  describe('the answer', () => {
    it('maps each flight of the page with the local times of its airports, and gives the total of all matches', async () => {
      const { service, responses } = setup([
        { items: [found('MS1'), found('MS2')], total: [{ count: 12 }] },
      ]);

      const result = onePage(await service.search(query({ limit: 2 }), NOW));

      expect(responses.timeZonesOf).toHaveBeenCalledTimes(1);
      expect(responses.timeZonesOf).toHaveBeenCalledWith(['CAI', 'JFK']);
      expect(result.meta).toEqual({
        page: 1,
        limit: 2,
        total: 12,
        totalPages: 6,
      });
      expect(result.items.map((item) => item.flightNumber)).toEqual([
        'MS1',
        'MS2',
      ]);
      expect(result.items[0]).toMatchObject({
        departureLocal: '2027-06-15T14:30',
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'America/New_York',
        airline: {
          name: 'EgyptAir',
          code: 'MS',
          logoUrl: '/api/uploads/logo.png',
        },
        cabins: [{ availableSeats: 2, price: 25000, currency: 'USD' }],
      });
    });

    it('answers no match with a 200 empty page, not an error', async () => {
      const { service } = setup([{ items: [], total: [] }]);

      await expect(service.search(query(), NOW)).resolves.toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('the airports: in the airports list and different (the answers of FLT-03)', () => {
    const errorOf = async (
      search: SearchFlightsQueryDto,
      zones: Map<string, string>,
    ) => {
      const { service, flights } = setup(undefined, zones);
      const error = await service.search(search, NOW).catch((e: unknown) => e);
      expect(flights.aggregate).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse();
    };

    it('refuses an unknown departure airport', async () => {
      expect(
        await errorOf(
          query({ departureAirport: 'QQQ' }),
          new Map([['JFK', 'America/New_York']]),
        ),
      ).toEqual({
        message: 'Validation failed',
        errors: [
          {
            field: 'departureAirport',
            messages: ['departureAirport QQQ is not in the airports list'],
          },
        ],
      });
    });

    it('refuses an unknown arrival airport', async () => {
      expect(
        await errorOf(
          query({ arrivalAirport: 'QQQ' }),
          new Map([['CAI', 'Africa/Cairo']]),
        ),
      ).toEqual({
        message: 'Validation failed',
        errors: [
          {
            field: 'arrivalAirport',
            messages: ['arrivalAirport QQQ is not in the airports list'],
          },
        ],
      });
    });

    it('lists both unknown airports in one answer', async () => {
      const response = (await errorOf(
        query({ departureAirport: 'QQQ', arrivalAirport: 'ZZZ' }),
        new Map(),
      )) as { errors: { field: string }[] };

      expect(response.errors.map((error) => error.field)).toEqual([
        'departureAirport',
        'arrivalAirport',
      ]);
    });

    it('refuses identical airports', async () => {
      expect(
        await errorOf(
          query({ arrivalAirport: 'CAI' }),
          new Map([['CAI', 'Africa/Cairo']]),
        ),
      ).toEqual({
        message: 'Validation failed',
        errors: [
          {
            field: 'arrivalAirport',
            messages: [
              'arrivalAirport must be different from departureAirport',
            ],
          },
        ],
      });
    });
  });
});

describe('FlightSearchService: price range and order (FLT-15)', () => {
  type Expression = number | string | { [operator: string]: Expression[] };

  /** Evaluates the operators the cabin condition uses, as MongoDB does. */
  const evaluate = (
    expression: Expression,
    cabin: Record<string, number>,
  ): number | boolean => {
    if (typeof expression === 'number') return expression;
    if (typeof expression === 'string') {
      return cabin[expression.replace('$$cabin.', '')];
    }
    const [operator, args] = Object.entries(expression)[0];
    const values = args.map((arg) => evaluate(arg, cabin));
    if (operator === '$and') return values.every(Boolean);
    const [a, b] = values as number[];
    if (operator === '$gte') return a >= b;
    if (operator === '$lte') return a <= b;
    if (operator === '$subtract') return a - b;
    if (operator === '$add')
      return (values as number[]).reduce((sum, value) => sum + value, 0);
    throw new Error(`Unexpected operator ${operator}`);
  };

  const condition = (change: Partial<SearchFlightsQueryDto>): Expression => {
    const { service } = setup();
    const stage = service.pipeline(query(change), NOW)[1] as unknown as {
      $addFields: { fittingCabins: { $filter: { cond: Expression } } };
    };
    return stage.$addFields.fittingCabins.$filter.cond;
  };

  const cabin = (price: number) => ({
    totalSeats: 10,
    bookedSeats: 0,
    heldSeats: 0,
    price,
  });

  /** The `$facet` page of a pipeline, and the stages before it. */
  const pageOf = (change: Partial<SearchFlightsQueryDto>) => {
    const { service } = setup();
    const stages = service.pipeline(query(change), NOW) as unknown as Record<
      string,
      unknown
    >[];
    const facet = stages[stages.length - 1].$facet as {
      items: Record<string, unknown>[];
    };
    return { stages, items: facet.items };
  };

  it('keeps a cabin whose price is inside the range, the bounds included', () => {
    const cond = condition({ minPrice: 20000, maxPrice: 30000 });

    expect(evaluate(cond, cabin(19999))).toBe(false);
    expect(evaluate(cond, cabin(20000))).toBe(true);
    expect(evaluate(cond, cabin(25000))).toBe(true);
    expect(evaluate(cond, cabin(30000))).toBe(true);
    expect(evaluate(cond, cabin(30001))).toBe(false);
  });

  it('still asks for the seats: a cabin in the range without enough seats is not kept', () => {
    const cond = condition({ minPrice: 0, maxPrice: 30000, passengers: 3 });

    expect(evaluate(cond, { ...cabin(25000), bookedSeats: 8 })).toBe(false);
    expect(evaluate(cond, { ...cabin(25000), bookedSeats: 7 })).toBe(true);
  });

  it('uses each bound alone, and no bound at all as in FLT-11', () => {
    expect(evaluate(condition({ minPrice: 20000 }), cabin(999999))).toBe(true);
    expect(evaluate(condition({ minPrice: 20000 }), cabin(19999))).toBe(false);
    expect(evaluate(condition({ maxPrice: 20000 }), cabin(0))).toBe(true);
    expect(evaluate(condition({ maxPrice: 20000 }), cabin(20001))).toBe(false);
    expect(Object.keys(condition({}))).toEqual(['$gte']);
  });

  it('sorts by the price of the cheapest cabin listed, computed after the cabin filter, then by id', () => {
    const { stages, items } = pageOf({ sortBy: 'price' });

    expect(stages[3]).toEqual({
      $addFields: { lowestPrice: { $min: '$fittingCabins.price' } },
    });
    expect(stages[2]).toEqual({
      $match: { 'fittingCabins.0': { $exists: true } },
    });
    expect(items[0]).toEqual({ $sort: { lowestPrice: 1, _id: 1 } });
    expect(items[3]).toEqual({
      $project: { cabins: 0, __v: 0, lowestPrice: 0 },
    });
  });

  it('sorts by duration (arrival minus departure), longest first with desc', () => {
    const { stages, items } = pageOf({
      sortBy: 'duration',
      sortOrder: 'desc',
    });

    expect(stages[3]).toEqual({
      $addFields: { durationMs: { $subtract: ['$arrivalAt', '$departureAt'] } },
    });
    expect(items[0]).toEqual({ $sort: { durationMs: -1, _id: 1 } });
    expect(items[3]).toEqual({
      $project: { cabins: 0, __v: 0, durationMs: 0 },
    });
  });

  it('sorts by the stored departure time with no computed field, latest first with desc', () => {
    const { stages, items } = pageOf({
      sortBy: 'departureTime',
      sortOrder: 'desc',
    });

    expect(
      stages.some((stage) => '$addFields' in stage && stage !== stages[1]),
    ).toBe(false);
    expect(items[0]).toEqual({ $sort: { departureAt: -1, _id: 1 } });
    expect(items[3]).toEqual({ $project: { cabins: 0, __v: 0 } });
  });

  it('pages after the sort, in the database, so total and pages stay correct', () => {
    const { items } = pageOf({ sortBy: 'price', page: 3, limit: 5, skip: 10 });

    expect(items.slice(0, 3)).toEqual([
      { $sort: { lowestPrice: 1, _id: 1 } },
      { $skip: 10 },
      { $limit: 5 },
    ]);
  });

  it('refuses a minimum above the maximum with 400 naming both, before any query', async () => {
    const { service, flights, responses } = setup();

    const error = await service
      .search(query({ minPrice: 30001, maxPrice: 30000 }), NOW)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: 'Validation failed',
      errors: [{ field: 'minPrice', messages: [PRICE_RANGE_MESSAGE] }],
    });
    expect(PRICE_RANGE_MESSAGE).toBe(
      'minPrice must not be greater than maxPrice',
    );
    expect(responses.timeZonesOf).not.toHaveBeenCalled();
    expect(flights.aggregate).not.toHaveBeenCalled();
  });

  it('accepts equal bounds', async () => {
    const { service, flights } = setup();

    await service.search(query({ minPrice: 25000, maxPrice: 25000 }), NOW);

    expect(flights.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe('FlightSearchService: cabin filter (FLT-12(c))', () => {
  type Expression =
    number | string | boolean | { [operator: string]: Expression[] };

  /** Evaluates the operators the cabin condition uses, as MongoDB does. */
  const evaluate = (
    expression: Expression,
    cabin: Record<string, number | string>,
  ): number | string | boolean => {
    if (typeof expression !== 'object') {
      return typeof expression === 'string' && expression.startsWith('$$cabin.')
        ? cabin[expression.replace('$$cabin.', '')]
        : expression;
    }
    const [operator, args] = Object.entries(expression)[0];
    const values = args.map((arg) => evaluate(arg, cabin));
    if (operator === '$and') return values.every(Boolean);
    if (operator === '$eq') return values[0] === values[1];
    const [a, b] = values as number[];
    if (operator === '$gte') return a >= b;
    if (operator === '$lte') return a <= b;
    if (operator === '$subtract') return a - b;
    if (operator === '$add')
      return (values as number[]).reduce((sum, value) => sum + value, 0);
    throw new Error(`Unexpected operator ${operator}`);
  };

  const stagesOf = (change: Partial<SearchFlightsQueryDto>) =>
    setup().service.pipeline(query(change), NOW) as unknown as Record<
      string,
      Record<string, unknown>
    >[];

  const conditionOf = (change: Partial<SearchFlightsQueryDto>): Expression =>
    (
      stagesOf(change)[1] as unknown as {
        $addFields: { fittingCabins: { $filter: { cond: Expression } } };
      }
    ).$addFields.fittingCabins.$filter.cond;

  const cabin = (name: CabinClass, change: Record<string, number> = {}) => ({
    cabin: name,
    totalSeats: 10,
    bookedSeats: 0,
    heldSeats: 0,
    price: 25000,
    ...change,
  });

  it('keeps only a cabin of the class asked for', () => {
    const cond = conditionOf({ cabin: CabinClass.Business });

    expect(evaluate(cond, cabin(CabinClass.Business))).toBe(true);
    for (const other of [
      CabinClass.Economy,
      CabinClass.PremiumEconomy,
      CabinClass.First,
    ]) {
      expect(evaluate(cond, cabin(other))).toBe(false);
    }
  });

  it('still asks for the seats and the price range in the same condition', () => {
    const cond = conditionOf({
      cabin: CabinClass.Business,
      passengers: 3,
      minPrice: 20000,
      maxPrice: 30000,
    });

    expect(evaluate(cond, cabin(CabinClass.Business))).toBe(true);
    // Not enough seats left.
    expect(
      evaluate(
        cond,
        cabin(CabinClass.Business, { bookedSeats: 6, heldSeats: 2 }),
      ),
    ).toBe(false);
    // Outside the price range.
    expect(evaluate(cond, cabin(CabinClass.Business, { price: 30001 }))).toBe(
      false,
    );
  });

  it('drops a flight without that cabin in the first $match, which uses the route index', () => {
    expect(stagesOf({ cabin: CabinClass.First })[0].$match).toEqual(
      expect.objectContaining({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDateLocal: '2027-06-15',
        'cabins.cabin': CabinClass.First,
      }),
    );
  });

  it('adds nothing without a cabin: the pipeline of FLT-11 and FLT-15', () => {
    const stages = stagesOf({});

    expect(stages[0].$match).not.toHaveProperty(['cabins.cabin']);
    expect(JSON.stringify(stages)).not.toContain('$eq');
  });
});

describe('FlightSearchService: round trip (FLT-12(a))', () => {
  const page = (numbers: string[], count: number) => [
    { items: numbers.map(found), total: count ? [{ count }] : [] },
  ];

  it('without returnDate answers one page from one aggregation (one-way)', async () => {
    const { service, flights } = setup(page(['MS1'], 1));

    const result = await service.search(query(), NOW);

    expect(flights.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [expect.objectContaining({ flightNumber: 'MS1' })],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    expect(result).not.toHaveProperty('outbound');
  });

  it('with returnDate searches the route and the reversed route on the return date, and answers { outbound, return }', async () => {
    const { service, flights, exec, responses } = setup();
    exec
      .mockResolvedValueOnce(page(['MS1', 'MS2'], 2))
      .mockResolvedValueOnce(page(['MS9'], 1));

    const result = await service.search(
      query({ returnDate: '2027-06-22', limit: 5 }),
      NOW,
    );

    // One airport lookup for both legs.
    expect(responses.timeZonesOf).toHaveBeenCalledTimes(1);
    expect(flights.aggregate).toHaveBeenCalledTimes(2);
    const [outboundStages, returnStages] = (
      flights.aggregate.mock.calls as unknown as [Record<string, unknown>[]][]
    ).map(([stages]) => stages);
    expect(outboundStages[0].$match).toEqual(
      expect.objectContaining({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDateLocal: '2027-06-15',
      }),
    );
    expect(returnStages[0].$match).toEqual(
      expect.objectContaining({
        departureAirport: 'JFK',
        arrivalAirport: 'CAI',
        departureDateLocal: '2027-06-22',
      }),
    );
    expect(result).toEqual({
      outbound: {
        items: [
          expect.objectContaining({ flightNumber: 'MS1' }),
          expect.objectContaining({ flightNumber: 'MS2' }),
        ],
        meta: { page: 1, limit: 5, total: 2, totalPages: 1 },
      },
      return: {
        items: [expect.objectContaining({ flightNumber: 'MS9' })],
        meta: { page: 1, limit: 5, total: 1, totalPages: 1 },
      },
    });
  });

  it('gives each leg the local times of its own airports: the return leaves in New York', async () => {
    const { service, exec } = setup();
    exec.mockResolvedValueOnce(page(['MS1'], 1)).mockResolvedValueOnce([
      {
        items: [
          {
            ...found('MS9'),
            departureAirport: 'JFK',
            arrivalAirport: 'CAI',
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const result = (await service.search(
      query({ returnDate: '2027-06-22' }),
      NOW,
    )) as {
      outbound: {
        items: { departureTimeZone: string; arrivalTimeZone: string }[];
      };
      return: {
        items: { departureTimeZone: string; arrivalTimeZone: string }[];
      };
    };

    expect(result.outbound.items[0]).toMatchObject({
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
    });
    expect(result.return.items[0]).toMatchObject({
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
    });
  });

  it('applies the same passengers, cabin, price range, order and page to both legs', async () => {
    const { service, flights } = setup();
    const filters = {
      returnDate: '2027-06-22',
      passengers: 3,
      cabin: CabinClass.Business,
      minPrice: 10000,
      maxPrice: 90000,
      sortBy: 'price' as const,
      sortOrder: 'desc' as const,
      page: 2,
      limit: 4,
      skip: 4,
    };

    await service.search(query(filters), NOW);

    const [outboundStages, returnStages] = (
      flights.aggregate.mock.calls as unknown as [Record<string, unknown>[]][]
    ).map(([stages]) => JSON.stringify(stages.slice(1)));
    // Everything after the route and date is the same.
    expect(returnStages).toBe(outboundStages);
    expect(outboundStages).toContain('"$skip":4');
    expect(outboundStages).toContain('"$limit":4');
    expect(outboundStages).toContain('"lowestPrice":-1');
  });

  it('answers an empty return page as a 200 page, not an error', async () => {
    const { service, exec } = setup();
    exec
      .mockResolvedValueOnce(page(['MS1'], 1))
      .mockResolvedValueOnce([{ items: [], total: [] }]);

    const result = (await service.search(
      query({ returnDate: '2027-06-22' }),
      NOW,
    )) as { return: unknown };

    expect(result.return).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('searches at the current time when no `now` is given (the controller sends none)', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const { service, flights } = setup();

      await service.search(query());

      const [stages] = flights.aggregate.mock.calls[0] as unknown as [
        { $match: { departureAt: { $gt: Date } } }[],
      ];
      expect(stages[0].$match.departureAt).toEqual({ $gt: NOW });
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers an empty page when the aggregation gives no result at all', async () => {
    const { service } = setup([]);

    expect(await service.search(query(), NOW)).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('accepts a return on the departure date (a same-day round trip)', async () => {
    const { service, flights } = setup();

    await service.search(query({ returnDate: '2027-06-15' }), NOW);

    expect(flights.aggregate).toHaveBeenCalledTimes(2);
  });

  it('refuses a return date before the departure date with 400 on returnDate, before any query', async () => {
    const { service, flights, responses } = setup();

    await expect(
      service.search(query({ returnDate: '2027-06-14' }), NOW),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed',
        errors: [
          {
            field: 'returnDate',
            messages: ['returnDate cannot be before departureDate'],
          },
        ],
      },
    });
    expect(responses.timeZonesOf).not.toHaveBeenCalled();
    expect(flights.aggregate).not.toHaveBeenCalled();
  });

  it('reports a wrong return date and a wrong price range in one answer', async () => {
    const { service } = setup();

    await expect(
      service.search(
        query({ returnDate: '2027-06-01', minPrice: 9, maxPrice: 1 }),
        NOW,
      ),
    ).rejects.toMatchObject({
      response: {
        errors: [
          {
            field: 'minPrice',
            messages: ['minPrice must not be greater than maxPrice'],
          },
          {
            field: 'returnDate',
            messages: ['returnDate cannot be before departureDate'],
          },
        ],
      },
    });
  });

  it('checks the airports once for both legs, with the answers of FLT-03', async () => {
    const { service, flights } = setup(
      undefined,
      new Map([['CAI', 'Africa/Cairo']]),
    );

    await expect(
      service.search(query({ returnDate: '2027-06-22' }), NOW),
    ).rejects.toMatchObject({
      response: {
        errors: [
          {
            field: 'arrivalAirport',
            messages: ['arrivalAirport JFK is not in the airports list'],
          },
        ],
      },
    });
    expect(flights.aggregate).not.toHaveBeenCalled();
  });

  it('pipeline() searches the outbound leg of the query when no leg is given', () => {
    const { service } = setup();
    const stages = service.pipeline(query(), NOW) as unknown as Record<
      string,
      Record<string, unknown>
    >[];

    expect(stages[0].$match).toEqual(
      expect.objectContaining({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDateLocal: '2027-06-15',
      }),
    );
    expect(outboundLeg(query({ returnDate: '2027-06-22' }))).toEqual({
      from: ['CAI'],
      to: ['JFK'],
      date: '2027-06-15',
    });
  });
});

describe('FlightSearchService.searchBetween (ITN-26)', () => {
  const ZONES3 = new Map([
    ['CAI', 'Africa/Cairo'],
    ['JFK', 'America/New_York'],
    ['EWR', 'America/New_York'],
  ]);
  const filters = (change: Partial<SearchFlightsQueryDto> = {}) =>
    ({
      passengers: 2,
      page: 1,
      limit: 10,
      skip: 0,
      sortBy: 'departureTime',
      sortOrder: 'asc',
      ...change,
    }) as SearchFlightsQueryDto;
  const route = {
    from: ['CAI'],
    to: ['JFK', 'EWR'],
    departureDate: '2027-06-15',
  };
  const matchOf = (flights: ReturnType<typeof setup>['flights'], call = 0) =>
    (
      flights.aggregate.mock.calls[call] as unknown as [
        { $match: Record<string, unknown> }[],
      ]
    )[0][0].$match;

  it('searches every destination airport in one aggregation, with the filters of the search', async () => {
    const { service, flights, responses } = setup(undefined, ZONES3);

    const result = await service.searchBetween(
      filters({ cabin: CabinClass.Business, maxPrice: 50000 }),
      route,
      NOW,
    );

    expect(responses.timeZonesOf).toHaveBeenCalledWith(['CAI', 'JFK', 'EWR']);
    expect(flights.aggregate).toHaveBeenCalledTimes(1);
    expect(matchOf(flights)).toEqual(
      expect.objectContaining({
        departureAirport: 'CAI',
        arrivalAirport: { $in: ['JFK', 'EWR'] },
        departureDateLocal: '2027-06-15',
        'cabins.cabin': CabinClass.Business,
      }),
    );
    expect(result).toEqual({
      outbound: {
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
      return: null,
    });
  });

  it('maps each flight with the time zones of its own airports', async () => {
    const { service } = setup(
      [
        {
          items: [{ ...found('UA1'), arrivalAirport: 'EWR' }],
          total: [{ count: 1 }],
        },
      ],
      new Map([
        ['CAI', 'Africa/Cairo'],
        ['JFK', 'America/New_York'],
        ['EWR', 'America/Toronto'],
      ]),
    );

    const result = await service.searchBetween(filters(), route, NOW);

    expect(result.outbound.items[0]).toMatchObject({
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/Toronto',
    });
  });

  it('with a return date also searches back from every destination airport to the origin', async () => {
    const { service, flights } = setup(undefined, ZONES3);

    const result = await service.searchBetween(
      filters(),
      { ...route, returnDate: '2027-06-22' },
      NOW,
    );

    expect(flights.aggregate).toHaveBeenCalledTimes(2);
    expect(matchOf(flights, 1)).toEqual(
      expect.objectContaining({
        departureAirport: { $in: ['JFK', 'EWR'] },
        arrivalAirport: 'CAI',
        departureDateLocal: '2027-06-22',
      }),
    );
    expect(result.return).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('asks each time zone once, even when an airport is on both sides', async () => {
    const { service, responses } = setup(undefined, ZONES3);

    await service.searchBetween(
      filters(),
      { from: ['CAI', 'JFK'], to: ['JFK'], departureDate: '2027-06-15' },
      NOW,
    );

    expect(responses.timeZonesOf).toHaveBeenCalledWith(['CAI', 'JFK']);
  });

  it('answers the 400s of the search before any query: a wrong price range and a return before the departure', async () => {
    const { service, flights, responses } = setup();

    await expect(
      service.searchBetween(
        filters({ minPrice: 9, maxPrice: 1 }),
        { ...route, returnDate: '2027-06-14' },
        NOW,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed',
        errors: [
          {
            field: 'minPrice',
            messages: ['minPrice must not be greater than maxPrice'],
          },
          {
            field: 'returnDate',
            messages: ['returnDate cannot be before departureDate'],
          },
        ],
      },
    });
    expect(responses.timeZonesOf).not.toHaveBeenCalled();
    expect(flights.aggregate).not.toHaveBeenCalled();
  });

  it('searches at the current time when no `now` is given', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const { service, flights } = setup(undefined, ZONES3);

      await service.searchBetween(filters(), route);

      expect(matchOf(flights).departureAt).toEqual({ $gt: NOW });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('crossFieldErrors (FLT-12, FLT-15)', () => {
  it('finds nothing for equal bounds, a missing bound, a same-day return or no return', () => {
    expect(
      crossFieldErrors(
        { minPrice: 5, maxPrice: 5 },
        '2027-06-15',
        '2027-06-15',
      ),
    ).toEqual([]);
    expect(crossFieldErrors({ minPrice: 5 }, '2027-06-15', undefined)).toEqual(
      [],
    );
    expect(
      crossFieldErrors({ maxPrice: 5 }, '2027-06-15', '2027-06-16'),
    ).toEqual([]);
  });
});
