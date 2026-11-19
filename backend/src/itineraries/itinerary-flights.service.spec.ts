import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import type {
  FlightSearchPages,
  FlightSearchService,
} from '../flights/flight-search.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { ItineraryTripType } from './enums/itinerary-trip-type.enum';
import {
  NO_AIRPORT_IN_FIRST_CITY_MESSAGE,
  NO_DAYS_FOR_FLIGHTS_MESSAGE,
  ORIGIN_IN_FIRST_CITY_MESSAGE,
  RETURN_DATE_ONE_WAY_MESSAGE,
} from './itineraries.constants';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected; nothing reads the database.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId().toString();
const itineraryId = new Types.ObjectId().toString();
const NOW = new Date('2027-01-01T10:00:00.000Z');

/** One day per city given, starting on `startDate`. */
const itinerary = (startDate: string, cities: string[]): ItineraryDocument =>
  new ItineraryModel({
    ownerId: new Types.ObjectId(ownerId),
    title: 'France',
    countries: ['FR'],
    startDate,
    dayCount: cities.length,
    days: cities.map((cityId) => ({ cityId })),
  }) as ItineraryDocument;

/** Paris on days 1-2, Lyon on day 3: the last day is 2027-06-17. */
const TRIP = () => itinerary('2027-06-15', ['paris', 'paris', 'lyon']);

/** The airports list: two in Paris, one in Cairo, one in Lyon. */
const AIRPORTS: Record<string, string> = {
  CDG: 'paris',
  ORY: 'paris',
  CAI: 'cairo',
  LYS: 'lyon',
};

const page = (total: number) => ({
  items: [],
  meta: { page: 1, limit: 10, total, totalPages: total ? 1 : 0 },
});

const query = (fields: Partial<ItineraryFlightsQueryDto> = {}) =>
  Object.assign(new ItineraryFlightsQueryDto(), {
    originAirport: 'CAI',
    passengers: 2,
    page: 1,
    limit: 10,
    ...fields,
  });

function setup(found: ItineraryDocument = TRIP()) {
  const itinerariesService = {
    findOwnedOrThrow: jest.fn().mockResolvedValue(found),
  };
  const pages: FlightSearchPages = { outbound: page(3), return: page(1) };
  const flightSearch = {
    searchBetween: jest.fn().mockResolvedValue(pages),
  };
  const lean = (value: unknown) => ({
    lean: () => ({ exec: () => Promise.resolve(value) }),
  });
  const airports = {
    find: jest.fn((filter: { cityId: string }) => ({
      select: () => ({
        sort: () =>
          lean(
            Object.entries(AIRPORTS)
              .filter(([, cityId]) => cityId === filter.cityId)
              .map(([code]) => ({ _id: code }))
              .sort((a, b) => a._id.localeCompare(b._id)),
          ),
      }),
    })),
    findById: jest.fn((code: string) => ({
      select: () =>
        lean(AIRPORTS[code] ? { _id: code, cityId: AIRPORTS[code] } : null),
    })),
  };
  const service = new ItineraryFlightsService(
    itinerariesService as unknown as ItinerariesService,
    flightSearch as unknown as FlightSearchService,
    airports as never,
  );
  return { service, itinerariesService, flightSearch, airports, pages };
}

const fieldErrors = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    (error as BadRequestException).getResponse() as {
      errors: { field: string; messages: string[] }[];
    }
  ).errors;
};

describe('ItineraryFlightsService (ITN-26)', () => {
  it('searches a round trip from the origin to every airport of the first city, from the start date to the last day', async () => {
    const { service, flightSearch, itinerariesService, airports, pages } =
      setup();

    const result = await service.search(itineraryId, query(), ownerId, NOW);

    expect(itinerariesService.findOwnedOrThrow).toHaveBeenCalledWith(
      itineraryId,
      ownerId,
      'You can only search flights for your own itineraries',
    );
    expect(airports.find).toHaveBeenCalledWith({ cityId: 'paris' });
    expect(flightSearch.searchBetween).toHaveBeenCalledWith(
      expect.objectContaining({ passengers: 2, page: 1, limit: 10 }),
      {
        from: ['CAI'],
        to: ['CDG', 'ORY'],
        departureDate: '2027-06-15',
        returnDate: '2027-06-17',
      },
      NOW,
    );
    expect(result).toEqual({
      search: {
        originAirport: 'CAI',
        cityId: 'paris',
        destinationAirports: ['CDG', 'ORY'],
        tripType: 'round_trip',
        departureDate: '2027-06-15',
        returnDate: '2027-06-17',
      },
      outbound: pages.outbound,
      return: pages.return,
    });
  });

  it('is a round trip by default (the DTO default) and when asked', async () => {
    expect(new ItineraryFlightsQueryDto().tripType).toBe(
      ItineraryTripType.RoundTrip,
    );
    const { service, flightSearch } = setup();

    await service.search(
      itineraryId,
      query({ tripType: ItineraryTripType.RoundTrip }),
      ownerId,
      NOW,
    );

    expect(flightSearch.searchBetween.mock.calls[0][1]).toMatchObject({
      returnDate: '2027-06-17',
    });
  });

  it('searches one way with no return date', async () => {
    const { service, flightSearch, pages } = setup();
    flightSearch.searchBetween.mockResolvedValue({
      outbound: pages.outbound,
      return: null,
    });

    const result = await service.search(
      itineraryId,
      query({ tripType: ItineraryTripType.OneWay }),
      ownerId,
      NOW,
    );

    expect(flightSearch.searchBetween.mock.calls[0][1]).toEqual({
      from: ['CAI'],
      to: ['CDG', 'ORY'],
      departureDate: '2027-06-15',
      returnDate: undefined,
    });
    expect(result.search).toMatchObject({
      tripType: 'one_way',
      returnDate: null,
    });
    expect(result.return).toBeNull();
  });

  it('uses the dates the user sends instead of the defaults', async () => {
    const { service, flightSearch } = setup();

    const result = await service.search(
      itineraryId,
      query({ departureDate: '2027-06-14', returnDate: '2027-06-20' }),
      ownerId,
      NOW,
    );

    expect(flightSearch.searchBetween.mock.calls[0][1]).toMatchObject({
      departureDate: '2027-06-14',
      returnDate: '2027-06-20',
    });
    expect(result.search).toMatchObject({
      departureDate: '2027-06-14',
      returnDate: '2027-06-20',
    });
  });

  it('gives a one-day itinerary a same-day return by default', async () => {
    const { service, flightSearch } = setup(itinerary('2027-12-31', ['paris']));

    await service.search(itineraryId, query(), ownerId, NOW);

    expect(flightSearch.searchBetween.mock.calls[0][1]).toMatchObject({
      departureDate: '2027-12-31',
      returnDate: '2027-12-31',
    });
  });

  it('counts the last day across the end of a year', async () => {
    const { service, flightSearch } = setup(
      itinerary('2027-12-30', ['paris', 'lyon', 'lyon', 'paris']),
    );

    await service.search(itineraryId, query(), ownerId, NOW);

    expect(flightSearch.searchBetween.mock.calls[0][1]).toMatchObject({
      to: ['CDG', 'ORY'],
      returnDate: '2028-01-02',
    });
  });

  it('passes the cabin, prices, order and page of flight search on unchanged', async () => {
    const { service, flightSearch } = setup();
    const filters = query({
      cabin: CabinClass.Business,
      minPrice: 1000,
      maxPrice: 90000,
      sortBy: 'price',
      sortOrder: 'desc',
      page: 2,
      limit: 5,
    });

    await service.search(itineraryId, filters, ownerId, NOW);

    expect(flightSearch.searchBetween.mock.calls[0][0]).toBe(filters);
  });

  it('searches at the current time when no `now` is given', async () => {
    const { service, flightSearch } = setup();

    await service.search(itineraryId, query(), ownerId);

    expect(flightSearch.searchBetween.mock.calls[0][2]).toBeInstanceOf(Date);
  });

  describe('refusals', () => {
    it('passes on the 404 of a missing itinerary and the 403 of another user', async () => {
      const missing = setup();
      missing.itinerariesService.findOwnedOrThrow.mockRejectedValue(
        new NotFoundException('Itinerary not found'),
      );
      const foreign = setup();
      foreign.itinerariesService.findOwnedOrThrow.mockRejectedValue(
        new ForbiddenException(
          'You can only search flights for your own itineraries',
        ),
      );

      await expect(
        missing.service.search(itineraryId, query(), ownerId, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        foreign.service.search(itineraryId, query(), ownerId, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(missing.flightSearch.searchBetween).not.toHaveBeenCalled();
      expect(foreign.airports.find).not.toHaveBeenCalled();
    });

    it('answers 404 for an itinerary without days: it has no first city', async () => {
      const { service, flightSearch, airports } = setup(
        itinerary('2027-06-15', []),
      );

      await expect(
        service.search(itineraryId, query(), ownerId, NOW),
      ).rejects.toThrow(new NotFoundException(NO_DAYS_FOR_FLIGHTS_MESSAGE));
      expect(airports.find).not.toHaveBeenCalled();
      expect(flightSearch.searchBetween).not.toHaveBeenCalled();
    });

    it('answers 404 when the first city has no airport', async () => {
      const { service, flightSearch } = setup(
        itinerary('2027-06-15', ['giza', 'paris']),
      );

      await expect(
        service.search(itineraryId, query(), ownerId, NOW),
      ).rejects.toThrow(
        new NotFoundException(NO_AIRPORT_IN_FIRST_CITY_MESSAGE),
      );
      expect(flightSearch.searchBetween).not.toHaveBeenCalled();
    });

    it('answers 400 on originAirport for a code not in the airports list', async () => {
      const { service, flightSearch } = setup();

      expect(
        await fieldErrors(
          service.search(
            itineraryId,
            query({ originAirport: 'QQQ' }),
            ownerId,
            NOW,
          ),
        ),
      ).toEqual([
        {
          field: 'originAirport',
          messages: ['originAirport QQQ is not in the airports list'],
        },
      ]);
      expect(flightSearch.searchBetween).not.toHaveBeenCalled();
    });

    it('answers 400 on originAirport for an airport in the first city itself', async () => {
      const { service } = setup();

      expect(
        await fieldErrors(
          service.search(
            itineraryId,
            query({ originAirport: 'ORY' }),
            ownerId,
            NOW,
          ),
        ),
      ).toEqual([
        { field: 'originAirport', messages: [ORIGIN_IN_FIRST_CITY_MESSAGE] },
      ]);
    });

    it('accepts an origin in another city of the itinerary', async () => {
      const { service, flightSearch } = setup();

      await service.search(
        itineraryId,
        query({ originAirport: 'LYS' }),
        ownerId,
        NOW,
      );

      expect(flightSearch.searchBetween).toHaveBeenCalledTimes(1);
    });

    it('answers 400 on returnDate when one sent one way', async () => {
      const { service } = setup();

      expect(
        await fieldErrors(
          service.search(
            itineraryId,
            query({
              tripType: ItineraryTripType.OneWay,
              returnDate: '2027-06-17',
            }),
            ownerId,
            NOW,
          ),
        ),
      ).toEqual([
        { field: 'returnDate', messages: [RETURN_DATE_ONE_WAY_MESSAGE] },
      ]);
    });

    it('answers 400 on returnDate when the outbound date is after the last day (the default return)', async () => {
      const { service } = setup();

      expect(
        await fieldErrors(
          service.search(
            itineraryId,
            query({ departureDate: '2027-06-18' }),
            ownerId,
            NOW,
          ),
        ),
      ).toEqual([
        {
          field: 'returnDate',
          messages: ['returnDate cannot be before departureDate'],
        },
      ]);
    });

    it('reports every problem in one answer, before any search', async () => {
      const { service, flightSearch } = setup();

      expect(
        await fieldErrors(
          service.search(
            itineraryId,
            query({
              originAirport: 'CDG',
              tripType: ItineraryTripType.OneWay,
              returnDate: '2027-06-17',
              minPrice: 9,
              maxPrice: 1,
            }),
            ownerId,
            NOW,
          ),
        ),
      ).toEqual([
        { field: 'originAirport', messages: [ORIGIN_IN_FIRST_CITY_MESSAGE] },
        { field: 'returnDate', messages: [RETURN_DATE_ONE_WAY_MESSAGE] },
        {
          field: 'minPrice',
          messages: ['minPrice must not be greater than maxPrice'],
        },
      ]);
      expect(flightSearch.searchBetween).not.toHaveBeenCalled();
    });
  });
});
