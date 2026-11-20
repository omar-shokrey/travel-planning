import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { SeatMapResponseDto } from './dto/booking-seats-response.dto';
import { FlightBookingDetailsResponseDto } from './dto/flight-booking-details-response.dto';
import { SelectSeatsDto } from './dto/select-seats.dto';
import {
  FLIGHT_BOOKING_SEATS_MAX,
  INFANT_SEAT_MESSAGE,
  SEATS_DEPARTED_MESSAGE,
  SEATS_FLIGHT_CANCELLED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEAT_TAKEN_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
} from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightSeatSelectionService } from './flight-seat-selection.service';

/** FLT-28: seat selection on the owner's flight booking. */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightSeatsController {
  constructor(private readonly selection: FlightSeatSelectionService) {}

  @Get(':id/seat-map')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Show the seat map of one of my flight bookings (FLT-28)',
    description:
      'Registered users only, their own booking, in any status. For each segment, every seat of the booked cabin in order (every cabin starts at row 1, so a seat is always named with its cabin), each `available`, `taken` (by someone else, who is never shown) or `yours` (a passenger of this booking), and each passenger with their seat on each segment (an infant takes none). Seat numbers are a row and a letter, for example `12C`.',
  })
  @ApiOkResponse({ type: SeatMapResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  seatMap(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<SeatMapResponseDto> {
    return this.selection.seatMap(id, userId);
  }

  @Patch(':id/seat')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Choose seats on one of my flight bookings (FLT-28)',
    description:
      'Registered users only, their own **confirmed** booking, before the flight departs. Choose or change the seat of one or more passengers on one segment (`segmentIndex`, required for a round trip), in the booked cabin, from the seat map. All or nothing: if one seat cannot be given, nobody changes seat. Every seat must be free when the request starts, except the seat the passenger already holds, so two passengers cannot swap seats in one request. The same seat again changes nothing. Choosing a seat never changes the price or the seat counts. Answers the booking details, as GET /api/flight-bookings/{id}.',
  })
  @ApiBody({ type: SelectSeatsDto })
  @ApiOkResponse({ type: FlightBookingDetailsResponseDto })
  @ApiBadRequestResponse({
    description: `The id is not a valid id; \`seats\` is missing, empty, has more than ${FLIGHT_BOOKING_SEATS_MAX} seats, names a passenger or a seat twice, or a seat is not a row and a letter; "${SEGMENT_INDEX_REQUIRED_MESSAGE}", or \`segmentIndex\` is not a segment of the booking; a \`passengerIndex\` is not a passenger of the booking, or "${INFANT_SEAT_MESSAGE}"; the seat is not on the seat map of the booked cabin; or another field was sent (the cabin, the user and the booking are never sent)`,
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${SEATS_NOT_CONFIRMED_MESSAGE}" (waiting for payment, expired, cancelled or completed, also when it was cancelled during the request), "${SEATS_DEPARTED_MESSAGE}" (also when the flight no longer exists), "${SEATS_FLIGHT_CANCELLED_MESSAGE}", or "${SEAT_TAKEN_MESSAGE}"`,
  })
  select(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SelectSeatsDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingDetailsResponseDto> {
    return this.selection.select(id, userId, dto);
  }
}
