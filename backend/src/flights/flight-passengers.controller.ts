import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { FlightBookingsResponseDto } from './dto/flight-bookings-response.dto';
import { PASSENGER_CSV_HEADER } from './flight-passengers-csv';
import { FlightPassengersService } from './flight-passengers.service';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';

/** FLT-29: the bookings and the passenger list of a flight, for its airline's moderator. */
@ApiTags('Flights')
@ApiCookieAuth()
@Controller('flights')
export class FlightPassengersController {
  constructor(private readonly passengers: FlightPassengersService) {}

  @Get(':id/bookings')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: 'View the bookings of a flight and its seats remaining (FLT-29)',
    description: [
      "The airline moderator of the flight's airline only. The flight, in any status, with each cabin's `availableSeats` (the seats remaining per category: total - booked - held), and its paid bookings ordered by reference: the reference, the status (`confirmed`, `completed` once the flight has arrived, or `cancelled`), the cabin and seats on this flight, and each passenger's name and type.",
      'A booking waiting for payment or expired is not a booking yet and is not listed, but its held seats are counted out of `availableSeats`. `passengerCount` counts the passengers of the confirmed and completed bookings, infants included. No passport number, date of birth, price or customer account is shown to the airline.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: FlightBookingsResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: `Not an airline moderator, no assigned airline, or "${FOREIGN_FLIGHT_MESSAGE}"`,
  })
  @ApiNotFoundResponse({ description: `"${FLIGHT_NOT_FOUND_MESSAGE}"` })
  bookings(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingsResponseDto> {
    return this.passengers.bookingsOf(id, userId);
  }

  @Get(':id/passengers/export')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: 'Export the passenger list of a flight as CSV (FLT-29)',
    description: `The airline moderator of the flight's airline only. A UTF-8 CSV file (RFC 4180, CRLF lines) named \`passengers-<flight number>-<local departure date>.csv\`, with the columns ${PASSENGER_CSV_HEADER.map((c) => `\`${c}\``).join(', ')}: one row per passenger of the confirmed and completed bookings, ordered by reference. A value that a spreadsheet would run as a formula is prefixed with \`'\`.`,
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The passenger list',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: `Not an airline moderator, no assigned airline, or "${FOREIGN_FLIGHT_MESSAGE}"`,
  })
  @ApiNotFoundResponse({ description: `"${FLIGHT_NOT_FOUND_MESSAGE}"` })
  async export(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.passengers.passengerCsv(id, userId);
    return new StreamableFile(csv, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
      length: csv.length,
    });
  }
}
