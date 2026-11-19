import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import type { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import { FlightResponsesService } from './flight-responses.service';
import { scheduledFlightFilter } from './flight-status';
import {
  SAME_AIRPORTS_MESSAGE,
  unknownAirportMessage,
} from './flights.constants';
import {
  type FlightSearchSource,
  toFlightSearchResult,
} from './mappers/flight-search.mapper';
import { Airline } from './models/airline.schema';
import { Flight } from './models/flight.schema';

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
   * `passengers`. Ordered by departure time, then id. Only the cabins that
   * fit are returned. No match is a 200 with an empty page.
   */
  async search(
    query: SearchFlightsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<FlightSearchResultResponseDto>> {
    // A page so large that its skip is not a safe integer would reach
    // MongoDB as a `$skip` it refuses (500). The shared pagination DTO has no
    // upper limit on `page`, and this route is public, so it is refused here.
    if (!Number.isSafeInteger(query.skip)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: [{ field: 'page', messages: ['page is too large'] }],
      });
    }
    const zones = await this.responses.timeZonesOf([
      query.departureAirport,
      query.arrivalAirport,
    ]);
    this.assertAirports(query, zones);

    const [page] = await this.flights
      .aggregate<SearchPage>(this.pipeline(query, now))
      .exec();
    const total = page?.total[0]?.count ?? 0;
    const flightZones = {
      departure: zones.get(query.departureAirport) as string,
      arrival: zones.get(query.arrivalAirport) as string,
    };
    const items = (page?.items ?? []).map((flight) =>
      toFlightSearchResult(flight, now, flightZones),
    );
    return paginate(items, total, query);
  }

  /**
   * The search as one aggregation. The first `$match` uses the index
   * (`departureAirport`, `arrivalAirport`, `departureDateLocal`, `status`)
   * and carries `scheduledFlightFilter(now)`. The seat rule needs a
   * comparison between fields of each cabin, which `$elemMatch` cannot do,
   * so `$filter` keeps the cabins that fit; a flight without one is dropped.
   * The airline comes with `$lookup`, which also drops an inactive airline,
   * so the whole page needs no other query. `$facet` counts every match and
   * cuts the page, both from the same matches.
   */
  pipeline(query: SearchFlightsQueryDto, now: Date): PipelineStage[] {
    return [
      {
        $match: {
          departureAirport: query.departureAirport,
          arrivalAirport: query.arrivalAirport,
          departureDateLocal: query.departureDate,
          ...scheduledFlightFilter(now),
        },
      },
      {
        $addFields: {
          fittingCabins: {
            $filter: {
              // A flight stored before FLT-04 has no `cabins`: it never matches.
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
                  query.passengers,
                ],
              },
            },
          },
        },
      },
      { $match: { 'fittingCabins.0': { $exists: true } } },
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
            { $sort: { departureAt: 1, _id: 1 } },
            { $skip: query.skip },
            { $limit: query.limit },
            { $project: { cabins: 0, __v: 0 } },
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
