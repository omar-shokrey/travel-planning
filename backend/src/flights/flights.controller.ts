import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightResponseDto } from './dto/flight-response.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import {
  AIRPORTS_LOCKED_MESSAGE,
  DUPLICATE_FLIGHT_MESSAGE,
  EMPTY_FLIGHT_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.AirlineModerator)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a flight (FLT-03)',
    description: [
      "Airline moderators only. The flight belongs to the moderator's assigned airline; the client never sends `airlineId` or `status` (sending them, or any other unknown field, answers 400). A new flight is `scheduled`.",
      "`departureLocal` and `arrivalLocal` are typed in each airport's local time (`YYYY-MM-DDTHH:mm`, seconds optional, no `Z` or offset) and stored in UTC, converted with the airport's IANA time zone.",
      'Rules, each a 400 that names its field: both airports must be in the airports list (FLT-02, GET /api/airports); the airports must differ; a local time that does not exist in its time zone (inside a daylight saving change that skips it) is refused; the arrival must be after the departure, compared in UTC; the departure must be in the future. A local time that happens twice (the clocks go back) is accepted as the second, standard-time instant. All broken rules are listed in one answer.',
      '`departureDateLocal` is the departure date at the departure airport. The same flight number cannot be used twice by one airline on the same departure date (409), whatever the status of the earlier flight, cancelled included.',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({
    type: FlightResponseDto,
    description:
      'The flight was created: UTC times, the local departure date and status `scheduled`.',
  })
  @ApiBadRequestResponse({
    description:
      'A field is invalid. `errors` lists each field with its messages: a missing or malformed field, an unknown airport, identical airports, a local time that does not exist, an arrival not after the departure (in UTC), a departure in the past, or a field the client may not send (`airlineId`, `status`, any other).',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'Not an airline moderator, or an airline moderator with no assigned airline',
  })
  @ApiNotFoundResponse({
    description:
      "Airline not found: the moderator's assignment names an airline that no longer exists",
  })
  @ApiConflictResponse({ description: DUPLICATE_FLIGHT_MESSAGE })
  create(
    @Body() dto: CreateFlightDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightResponseDto> {
    return this.flightsService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.AirlineModerator)
  @ApiCookieAuth()
  @ApiParam({
    name: 'id',
    description: 'Flight id',
    example: '6740f1c2a4b5c6d7e8f90456',
  })
  @ApiOperation({
    summary: 'Edit the times or the airports of a scheduled flight (FLT-05)',
    description: [
      "Airline moderators only, for a scheduled flight of the moderator's assigned airline. Send only the fields to change: `departureLocal`, `arrivalLocal` (each airport's local time, `YYYY-MM-DDTHH:mm`, as in POST /api/flights), `departureAirport`, `arrivalAirport`. Anything else (`flightNumber`, `airlineId`, `status`, `departureDateLocal`, `cabins`, the seat counters) answers 400. Cabin prices and seat counts are changed with PATCH /api/flights/{id}/cabins/{cabinId}.",
      'The rules of POST /api/flights apply to the flight as it will be, a field that is not sent keeping its stored value: the airports must be in the airports list and differ, a local time must exist in its time zone, the departure must be in the future and the arrival after it, compared in UTC. A time that is not sent keeps its instant, also at a new airport. `departureDateLocal` is recomputed. All broken rules are listed in one 400.',
      'The airports cannot be changed once the flight has a booking: seats booked or held in a cabin, or a booking waiting for its payment or confirmed (409). Sending the airport the flight already has is not a change. The times can still be changed: every passenger with a confirmed booking then gets one in-app notification with the old and new local times.',
      'Answers the whole flight with its cabins.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: FlightResponseDto,
    description:
      'The flight was changed. The answer is the flight with its new UTC and local times, its local departure date and its cabins.',
  })
  @ApiBadRequestResponse({
    description: `The id is not a valid id; a field is invalid, null or not allowed; an unknown or repeated airport; a local time that does not exist; a departure in the past; an arrival not after the departure; or no field was sent ("${EMPTY_FLIGHT_UPDATE_MESSAGE}")`,
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: `Not an airline moderator, an airline moderator with no assigned airline, or "${FOREIGN_FLIGHT_MESSAGE}"`,
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}", or "Airline not found": the moderator's assignment names an airline that no longer exists`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_SCHEDULED_MESSAGE}" (cancelled or departed, or its departure time has passed); "${AIRPORTS_LOCKED_MESSAGE}"; "${DUPLICATE_FLIGHT_MESSAGE}" (the new local departure date); or "${FLIGHT_CHANGED_MESSAGE}" (another request changed it at the same moment)`,
  })
  update(
    @Param('id', ParseObjectIdPipe) flightId: string,
    @Body() dto: UpdateFlightDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightResponseDto> {
    return this.flightsService.update(flightId, dto, userId);
  }
}
