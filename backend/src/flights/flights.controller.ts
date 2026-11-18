import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightResponseDto } from './dto/flight-response.dto';
import { DUPLICATE_FLIGHT_MESSAGE } from './flights.constants';
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
  @ApiConflictResponse({ description: DUPLICATE_FLIGHT_MESSAGE })
  create(
    @Body() dto: CreateFlightDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightResponseDto> {
    return this.flightsService.create(dto, userId);
  }
}
