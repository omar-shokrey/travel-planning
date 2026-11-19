import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import type { RoundTripSearchResponseDto } from './dto/round-trip-search-response.dto';
import type { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import { FlightResponsesService } from './flight-responses.service';
import { scheduledFlightFilter } from './flight-status';
import {
  type FlightSearchSort,
  PRICE_RANGE_MESSAGE,
  RETURN_BEFORE_DEPARTURE_MESSAGE,
  SAME_AIRPORTS_MESSAGE,
  unknownAirportMessage,
} from './flights.constants';
import {
  type FlightSearchSource,
  toFlightSearchResult,
} from './mappers/flight-search.mapper';
import { Airline } from './models/airline.schema';
import { Flight } from './models/flight.schema';

/**
 * The field each order of FLT-15 sorts on. `lowestPrice` and `durationMs` are
 * computed in the pipeline; `departureAt` is stored.
 */
const SORT_FIELDS: Record<FlightSearchSort, string> = {
  price: 'lowestPrice',
  duration: 'durationMs',
  departureTime: 'departureAt',
};

/**
 * One direction of a search: the airports it may leave from and arrive at,
 * and the local date at the departure airport. A one-way search has one leg;
 * a round trip (FLT-12) has the outbound leg and the return leg, the same
 * airports reversed on `returnDate`. FLT-11 sends one airport on each side;
 * ITN-26 sends every airport of a city as the destination.
 */
export interface SearchLeg {
  from: readonly string[];
  to: readonly string[];
  date: string;
}

/** The outbound leg of a query: the route and the date as sent. */
export const outboundLeg = (
  query: Pick<
    SearchFlightsQueryDto,
    'departureAirport' | 'arrivalAirport' | 'departureDate'
  >,
): SearchLeg => ({
  from: [query.departureAirport],
  to: [query.arrivalAirport],
  date: query.departureDate,
});

/**
 * The filters, order and page of a search, without the route and the dates:
 * what another module passes to `searchBetween` (ITN-26). The same rules as
 * the query of `GET /api/flights/search`.
 */
export type FlightSearchFilters = Pick<
  SearchFlightsQueryDto,
  | 'passengers'
  | 'cabin'
  | 'minPrice'
  | 'maxPrice'
  | 'sortBy'
  | 'sortOrder'
  | 'page'
  | 'limit'
  | 'skip'
>;

/** ITN-26: where and when to search, between sets of airports. */
export interface RouteSearch {
  /** Departure airports of the outbound flights (arrival of the return). */
  from: readonly string[];
  /** Arrival airports of the outbound flights (departure of the return). */
  to: readonly string[];
  /** Local date at the outbound departure airport, YYYY-MM-DD. */
  departureDate: string;
  /** Local date at the return departure airport; a one-way search has none. */
  returnDate?: string;
}

/** The outbound page and, for a round trip, the return page. */
export interface FlightSearchPages {
  outbound: PaginatedResponse<FlightSearchResultResponseDto>;
  return: PaginatedResponse<FlightSearchResultResponseDto> | null;
}

/**
 * The checks that compare two fields, made before any query: minPrice not
 * above maxPrice (FLT-15) and a return date not before the departure date
 * (FLT-12). Both dates are real YYYY-MM-DD dates, so the text order is the
 * date order. The field names are those of the search query.
 */
export function crossFieldErrors(
  filters: Pick<FlightSearchFilters, 'minPrice' | 'maxPrice'>,
  departureDate: string,
  returnDate: string | undefined,
): FieldError[] {
  const errors: FieldError[] = [];
  if (
    filters.minPrice !== undefined &&
    filters.maxPrice !== undefined &&
    filters.minPrice > filters.maxPrice
  ) {
    errors.push({ field: 'minPrice', messages: [PRICE_RANGE_MESSAGE] });
  }
  if (returnDate !== undefined && returnDate < departureDate) {
    errors.push({
      field: 'returnDate',
      messages: [RETURN_BEFORE_DEPARTURE_MESSAGE],
    });
  }
  return errors;
}

/** One airport as itself, several as `$in`: the route index serves both. */
const airportFilter = (codes: readonly string[]): string | { $in: string[] } =>
  codes.length === 1 ? codes[0] : { $in: [...codes] };

/** What the `$facet` stage gives: one page of flights and the count of all matches. */
interface SearchPage {
  items: FlightSearchSource[];
  total: { count: number }[];
}

/**
 * FLT-11: flight search for guests and users. Read only: no write, no lock,
 * no counter changed. Every condition is decided by the database in one
 * aggregation that pages there, so `total` counts exactly the flights the
 * pages show.
 */
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly responses: FlightResponsesService,
  ) {}

  /**
   * Flights on the route whose departure date at the departure airport is
   * `departureDate`, that are scheduled at `now` (FLT-30: stored as scheduled
   * and departing after `now`), of an active airline (ACC-15: `active: false`
   * is left out, an airline without the field counts as active), with at
   * least one cabin where `totalSeats - bookedSeats - heldSeats` is at least
   * `passengers`, of the `cabin` class when one is asked for (FLT-12(c)),
   * and whose price is inside `minPrice`..`maxPrice` (FLT-15, inclusive,
   * each bound optional). Only those cabins are returned. Ordered by
   * `sortBy` and `sortOrder` (by default the departure time, earliest
   * first), then by id. No match is a 200 with an empty page.
   *
   * FLT-12(a): with `returnDate` it is a round trip. The answer is then
   * `{ outbound, return }`: the page above, and the same search on the
   * reversed route (arrival airport to departure airport) on `returnDate`,
   * the local date at the arrival airport, with the same filters, order,
   * page and limit. Two aggregations, run together.
   */
  async search(
    query: SearchFlightsQueryDto,
    now: Date = new Date(),
  ): Promise<
    | PaginatedResponse<FlightSearchResultResponseDto>
    | RoundTripSearchResponseDto
  > {
    // Checked before any query, so a wrong range or date costs no lookup.
    const errors = crossFieldErrors(
      query,
      query.departureDate,
      query.returnDate,
    );
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    const zones = await this.responses.timeZonesOf([
      query.departureAirport,
      query.arrivalAirport,
    ]);
    this.assertAirports(query, zones);

    const pages = await this.searchPages(
      query,
      {
        from: [query.departureAirport],
        to: [query.arrivalAirport],
        departureDate: query.departureDate,
        returnDate: query.returnDate,
      },
      zones,
      now,
    );
    return pages.return === null
      ? pages.outbound
      : { outbound: pages.outbound, return: pages.return };
  }

  /**
   * ITN-26: the same search for another module, between sets of airports:
   * flights leaving any airport of `from` for any airport of `to` on
   * `departureDate` and, with `returnDate`, flights back from any airport of
   * `to` to any airport of `from` on that date. The filters, the order and
   * the page are those of FLT-11, FLT-12 and FLT-15, and one aggregation per
   * leg pages in the database, so `total` counts every airport together.
   *
   * The caller checks that the airports exist (they come from the airports
   * list). minPrice above maxPrice and a return before the departure answer
   * the same 400 as `GET /api/flights/search`. `now` is for tests.
   */
  async searchBetween(
    filters: FlightSearchFilters,
    route: RouteSearch,
    now: Date = new Date(),
  ): Promise<FlightSearchPages> {
    const errors = crossFieldErrors(
      filters,
      route.departureDate,
      route.returnDate,
    );
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    const zones = await this.responses.timeZonesOf([
      ...new Set([...route.from, ...route.to]),
    ]);
    return this.searchPages(filters, route, zones, now);
  }

  /** The outbound page and, with a return date, the return page, run together. */
  private async searchPages(
    filters: FlightSearchFilters,
    route: RouteSearch,
    zones: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<FlightSearchPages> {
    const outbound: SearchLeg = {
      from: route.from,
      to: route.to,
      date: route.departureDate,
    };
    if (route.returnDate === undefined) {
      return {
        outbound: await this.searchLeg(filters, outbound, zones, now),
        return: null,
      };
    }
    const [outboundPage, returnPage] = await Promise.all([
      this.searchLeg(filters, outbound, zones, now),
      this.searchLeg(
        filters,
        { from: route.to, to: route.from, date: route.returnDate },
        zones,
        now,
      ),
    ]);
    return { outbound: outboundPage, return: returnPage };
  }

  /**
   * One page of one leg. Each flight is mapped with the time zones of its own
   * two airports, so a leg with several airports shows every local time right.
   */
  private async searchLeg(
    filters: FlightSearchFilters,
    leg: SearchLeg,
    zones: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<PaginatedResponse<FlightSearchResultResponseDto>> {
    const [page] = await this.flights
      .aggregate<SearchPage>(this.legPipeline(filters, now, leg))
      .exec();
    const total = page?.total[0]?.count ?? 0;
    const items = (page?.items ?? []).map((flight) =>
      toFlightSearchResult(flight, now, {
        departure: zones.get(flight.departureAirport) as string,
        arrival: zones.get(flight.arrivalAirport) as string,
      }),
    );
    return paginate(items, total, filters);
  }

  /**
   * The search as one aggregation. The first `$match` uses the index
   * (`departureAirport`, `arrivalAirport`, `departureDateLocal`, `status`)
   * and carries `scheduledFlightFilter(now)`. The seat rule needs a
   * comparison between fields of each cabin, which `$elemMatch` cannot do,
   * so `$filter` keeps the cabins that fit; a flight without one is dropped.
   * The price range of FLT-15 is part of the same `$filter`: a cabin is kept
   * when it fits the party and its price is in the range. The airline comes
   * with `$lookup`, which also drops an inactive airline, so the whole page
   * needs no other query. `$facet` counts every match and sorts and cuts the
   * page, both from the same matches; the sort ends with `_id`, so equal
   * flights keep one order across pages. With the default order the pipeline
   * is the one of FLT-11.
   *
   * FLT-12: `leg` is the route and date to search (the outbound leg of the
   * query by default; the round trip's return leg reverses it). The cabin
   * filter is part of the same `$filter`, and the first `$match` asks for a
   * cabin of that class so flights without it are dropped early.
   */
  pipeline(
    query: SearchFlightsQueryDto,
    now: Date,
    leg: SearchLeg = outboundLeg(query),
  ): PipelineStage[] {
    return this.legPipeline(query, now, leg);
  }

  /** The pipeline of one leg; only the filters, order and page of the query are read. */
  private legPipeline(
    query: FlightSearchFilters,
    now: Date,
    leg: SearchLeg,
  ): PipelineStage[] {
    // The DTO gives the defaults; a query built in code may leave them out.
    const sortField = SORT_FIELDS[query.sortBy ?? 'departureTime'];
    const direction = query.sortOrder === 'desc' ? -1 : 1;
    const seatsLeft = {
      $gte: [
        {
          $subtract: [
            '$$cabin.totalSeats',
            { $add: ['$$cabin.bookedSeats', '$$cabin.heldSeats'] },
          ],
        },
        query.passengers,
      ],
    };
    const keep = [
      seatsLeft,
      ...(query.cabin === undefined
        ? []
        : [{ $eq: ['$$cabin.cabin', query.cabin] }]),
      ...(query.minPrice === undefined
        ? []
        : [{ $gte: ['$$cabin.price', query.minPrice] }]),
      ...(query.maxPrice === undefined
        ? []
        : [{ $lte: ['$$cabin.price', query.maxPrice] }]),
    ];
    // The computed sort keys, added only for the order that needs one.
    const sortKeys: Record<string, unknown> = {
      lowestPrice: { $min: '$fittingCabins.price' },
      durationMs: { $subtract: ['$arrivalAt', '$departureAt'] },
    };
    return [
      {
        $match: {
          departureAirport: airportFilter(leg.from),
          arrivalAirport: airportFilter(leg.to),
          departureDateLocal: leg.date,
          ...scheduledFlightFilter(now),
          ...(query.cabin === undefined ? {} : { 'cabins.cabin': query.cabin }),
        },
      },
      {
        $addFields: {
          fittingCabins: {
            $filter: {
              // A flight stored before FLT-04 has no `cabins`: it never matches.
              input: { $ifNull: ['$cabins', []] },
              as: 'cabin',
              cond: keep.length === 1 ? seatsLeft : { $and: keep },
            },
          },
        },
      },
      { $match: { 'fittingCabins.0': { $exists: true } } },
      ...(sortField in sortKeys
        ? [{ $addFields: { [sortField]: sortKeys[sortField] } }]
        : []),
      {
        $lookup: {
          from: this.airlines.collection.collectionName,
          localField: 'airlineId',
          foreignField: '_id',
          pipeline: [
            { $match: { active: { $ne: false } } },
            { $project: { name: 1, code: 1, logo: 1 } },
          ],
          as: 'airline',
        },
      },
      // No active airline (deactivated, or missing): the flight is not listed.
      { $unwind: '$airline' },
      {
        $facet: {
          items: [
            { $sort: { [sortField]: direction, _id: 1 } },
            { $skip: query.skip },
            { $limit: query.limit },
            {
              $project: {
                cabins: 0,
                __v: 0,
                ...(sortField in sortKeys ? { [sortField]: 0 } : {}),
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];
  }

  /**
   * Both airports must be in the airports list and differ, with the answers
   * of FLT-03: one 400 in the project shape that lists every broken rule.
   */
  private assertAirports(
    query: SearchFlightsQueryDto,
    zones: ReadonlyMap<string, string>,
  ): void {
    const departure: string[] = [];
    const arrival: string[] = [];
    if (!zones.has(query.departureAirport)) {
      departure.push(
        unknownAirportMessage('departureAirport', query.departureAirport),
      );
    }
    if (!zones.has(query.arrivalAirport)) {
      arrival.push(
        unknownAirportMessage('arrivalAirport', query.arrivalAirport),
      );
    }
    if (query.departureAirport === query.arrivalAirport) {
      arrival.push(SAME_AIRPORTS_MESSAGE);
    }
    const errors: FieldError[] = [
      ...(departure.length
        ? [{ field: 'departureAirport', messages: departure }]
        : []),
      ...(arrival.length
        ? [{ field: 'arrivalAirport', messages: arrival }]
        : []),
    ];
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
  }
}
