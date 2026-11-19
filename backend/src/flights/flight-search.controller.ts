import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  type PaginatedResponse,
  PaginationMeta,
} from '../common/dto/paginated-response.dto';
import { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import { RoundTripSearchResponseDto } from './dto/round-trip-search-response.dto';
import { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import {
  FLIGHT_SEARCH_PASSENGERS_MAX,
  PRICE_RANGE_MESSAGE,
  RETURN_BEFORE_DEPARTURE_MESSAGE,
} from './flights.constants';
import { FlightSearchService } from './flight-search.service';

/**
 * Flight search (FLT-11). `GET /flights/search` is a fixed path: this
 * controller is registered first in `FlightsModule`, so it is matched before
 * any `GET /flights/:id` (FLT-17) and `search` is never read as an id.
 */
@ApiTags('Flights')
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly flightSearch: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search flights (FLT-11), one-way or round trip and by cabin (FLT-12), filter by price and sort (FLT-15)',
    description: [
      'FLT-11. Open to guests and users: no login is needed.',
      `Give the departure airport, the arrival airport (both from GET /api/airports, different), the departure date at the departure airport (its local date, YYYY-MM-DD) and the number of passengers who need a seat (1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}).`,
      'Lists the scheduled flights of active airlines on that route and local date that have not departed yet and have a cabin with at least that many seats left (seats minus those booked or held). Each result has its airline, its UTC and local times, and only the cabins with enough seats, each with its id, price and available seats: the flight `id` and a cabin `id` are what the user selects to continue.',
      'FLT-12(a): add `returnDate` (the local date at the arrival airport, on or after departureDate) for a round trip. The answer is then `{ outbound, return }`: two pages of the same shape, the outbound flights and the return flights (arrival airport back to departure airport on returnDate), with the same passengers, cabin, price range, order, page and limit. The user then selects one outbound flight and cabin and one return flight and cabin, and books them as one booking (POST /api/flight-bookings/hold with returnFlightId and returnCabin). Without `returnDate` the answer is one page, as a one-way search.',
      'FLT-12(c): `cabin` (optional: economy, premium_economy, business or first) lists only flights with that cabin, with enough seats, and returns only that cabin.',
      'FLT-15: `minPrice` and `maxPrice` (optional, inclusive, whole cents of USD per seat) keep only the cabins inside the range: a flight is listed when one of its cabins fits the passengers and is in the range, and only those cabins are returned. `sortBy` orders by `price` (the cheapest cabin listed), `duration` (arrival minus departure) or `departureTime` (the default), `sortOrder` by `asc` (the default) or `desc`; equal flights keep a fixed order by id, so pages never repeat or skip a flight.',
      'Ordered by departure time unless `sortBy` says otherwise, 10 per page by default (`limit`, up to 50). When nothing matches, the answer is 200 with an empty page (`items: []`, `meta.total: 0`); the app then shows "no flights found". A date in the past is not an error: it finds no flight.',
    ].join('\n\n'),
  })
  @ApiExtraModels(
    PaginationMeta,
    FlightSearchResultResponseDto,
    RoundTripSearchResponseDto,
  )
  @ApiOkResponse({
    description:
      'One-way search (no returnDate): one page `{ items, meta }`. Round trip (with returnDate): `{ outbound, return }`, each a page of the same shape.',
    schema: {
      oneOf: [
        {
          title: 'One-way search',
          type: 'object',
          required: ['items', 'meta'],
          properties: {
            items: {
              type: 'array',
              items: { $ref: getSchemaPath(FlightSearchResultResponseDto) },
            },
            meta: { $ref: getSchemaPath(PaginationMeta) },
          },
        },
        {
          title: 'Round trip',
          $ref: getSchemaPath(RoundTripSearchResponseDto),
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    description: `A parameter is missing or malformed (\`errors\` names each one): an airport code that is not 3 letters, or that is not in the airports list, identical airports, a date that is not a real YYYY-MM-DD date, a returnDate before departureDate ("${RETURN_BEFORE_DEPARTURE_MESSAGE}"), an unknown cabin, passengers that is not a whole number from 1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}, a price that is not a whole number of cents from 0 up, minPrice above maxPrice ("${PRICE_RANGE_MESSAGE}"), an unknown sortBy or sortOrder, a bad page or limit, or a parameter this search does not have`,
  })
  search(
    @Query() query: SearchFlightsQueryDto,
  ): Promise<
    | PaginatedResponse<FlightSearchResultResponseDto>
    | RoundTripSearchResponseDto
  > {
    return this.flightSearch.search(query);
  }
}
