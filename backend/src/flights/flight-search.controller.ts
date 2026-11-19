import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import { FLIGHT_SEARCH_PASSENGERS_MAX } from './flights.constants';
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
    summary: 'Search flights (FLT-11)',
    description: [
      'FLT-11. Open to guests and users: no login is needed.',
      `Give the departure airport, the arrival airport (both from GET /api/airports, different), the departure date at the departure airport (its local date, YYYY-MM-DD) and the number of passengers who need a seat (1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}).`,
      'Lists the scheduled flights of active airlines on that route and local date that have not departed yet and have a cabin with at least that many seats left (seats minus those booked or held). Each result has its airline, its UTC and local times, and only the cabins with enough seats, each with its id, price and available seats: the flight `id` and a cabin `id` are what the user selects to continue.',
      'Ordered by departure time, 10 per page by default (`limit`, up to 50). When nothing matches, the answer is 200 with an empty page (`items: []`, `meta.total: 0`); the app then shows "no flights found". A date in the past is not an error: it finds no flight.',
    ].join('\n\n'),
  })
  @ApiPaginatedResponse(FlightSearchResultResponseDto)
  @ApiBadRequestResponse({
    description: `A parameter is missing or malformed (\`errors\` names each one): an airport code that is not 3 letters, or that is not in the airports list, identical airports, a date that is not a real YYYY-MM-DD date, passengers that is not a whole number from 1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}, a bad page or limit, or a parameter this search does not have`,
  })
  search(
    @Query() query: SearchFlightsQueryDto,
  ): Promise<PaginatedResponse<FlightSearchResultResponseDto>> {
    return this.flightSearch.search(query);
  }
}
