import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { ItineraryFlightsResponseDto } from './dto/itinerary-flights-response.dto';
import {
  NO_AIRPORT_IN_FIRST_CITY_MESSAGE,
  NO_DAYS_FOR_FLIGHTS_MESSAGE,
  ORIGIN_IN_FIRST_CITY_MESSAGE,
  RETURN_DATE_ONE_WAY_MESSAGE,
} from './itineraries.constants';
import { ItineraryFlightsService } from './itinerary-flights.service';

/**
 * ITN-26: the flights to the first city of an itinerary, under
 * `/api/itineraries/:id/flights`. Registered after the public itinerary
 * controller in the module, so the routes under `/api/itineraries/public/`
 * are matched first, as before.
 */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Roles(Role.User)
@Controller('itineraries')
export class ItineraryFlightsController {
  constructor(private readonly itineraryFlights: ItineraryFlightsService) {}

  @Get(':id/flights')
  @ApiOperation({
    summary: 'Flights to the first city of an itinerary',
    description: [
      "ITN-26. Search one-way or round-trip flights for your own itinerary, from the airport you choose (`originAirport`) to any airport in the city of the itinerary's first day. The outbound date defaults to the itinerary's start date and the return date to the date of its last day; send `departureDate` or `returnDate` to change them. `tripType` is `round_trip` by default, or `one_way`.",
      'The search is flight search (FLT-11, FLT-12, FLT-15): scheduled flights of active airlines with enough seats for `passengers`, the optional `cabin`, `minPrice`, `maxPrice`, `sortBy` and `sortOrder`, 10 per page by default. With several airports in the city, one page lists the flights to all of them together.',
      'The answer has `search` (what was searched, with the defaults filled in), `outbound` (a page of flights) and `return` (a page of flights back to the origin, or `null` one way). Nothing is stored; the flight id and a cabin id of a result are what the user books (POST /api/flight-bookings/hold, with returnFlightId for a round trip).',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryFlightsResponseDto })
  @ApiBadRequestResponse({
    description: `The id or a query value is invalid or unknown (originAirport missing, not 3 letters or not in the airports list; passengers, cabin, a date, a price, sortBy, sortOrder, page or limit invalid), "${ORIGIN_IN_FIRST_CITY_MESSAGE}", "${RETURN_DATE_ONE_WAY_MESSAGE}", a return date before the outbound date (also when it is the default, the last day's date), or minPrice above maxPrice`,
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: `No itinerary has this id, "${NO_DAYS_FOR_FLIGHTS_MESSAGE}", or "${NO_AIRPORT_IN_FIRST_CITY_MESSAGE}"`,
  })
  search(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryFlightsResponseDto> {
    return this.itineraryFlights.search(id, query, userId);
  }
}
