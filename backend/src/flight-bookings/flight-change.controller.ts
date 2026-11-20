import { Body, Controller, Param, Patch } from '@nestjs/common';
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
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  NOT_ENOUGH_SEATS_MESSAGE,
} from '../flights/flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { ChangeFlightDto } from './dto/change-flight.dto';
import { FlightChangeResponseDto } from './dto/flight-change-response.dto';
import {
  CHANGE_AGE_GROUP_MESSAGE,
  CHANGE_BAGS_MESSAGE,
  CHANGE_BOOKING_CHANGED_MESSAGE,
  CHANGE_DEPARTED_MESSAGE,
  CHANGE_DIFFERENCE_CHANGED_MESSAGE,
  CHANGE_IN_PROGRESS_MESSAGE,
  CHANGE_NOT_CONFIRMED_MESSAGE,
  CHANGE_REFUND_TOO_LARGE_MESSAGE,
  EXPECTED_DIFFERENCE_REQUIRED_MESSAGE,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  OUTBOUND_AFTER_RETURN_MESSAGE,
  POLICIES_REQUIRED_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  SAME_FLIGHT_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
} from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightChangeService } from './flight-change.service';

/** FLT-27: changing a flight of the owner's confirmed flight booking. */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightChangeController {
  constructor(private readonly changes: FlightChangeService) {}

  @Patch(':id/change-flight')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Change a flight of my confirmed flight booking (FLT-27)',
    description: [
      'Registered users only, their own **confirmed** booking, before the flight to change departs. Change one flight (`segmentIndex`, required for a round trip) to another flight on the **same route, in the same cabin**, with the same passengers and extra bags, subject to seat availability.',
      "**First a dry run** (`dryRun: true`): nothing changes; the answer shows the price of the flight in this booking before and after, the `difference`, the new total and the new airline's policies (cancellation tiers and bag rules), which replace the old ones for this flight.",
      '**Then the change**, with `expectedDifference` (the difference the dry run showed; if it is no longer that, 409 and nothing changes) and `policiesAccepted: true`. The new seats are held at once. **A dearer flight** (`difference` above 0) answers `pending_payment`: pay the difference within 10 minutes with `POST /api/payments` and `{ bookingType: "flight_change", bookingId: <change id> }` (the `payment` field); the booking changes only once the payment webhook reports it, otherwise the hold ends and nothing changes. **An equal or cheaper flight** changes at once (`completed`); a cheaper one\'s difference is refunded to the card (PAY-03, the `refund` field). The old flight\'s seats go back, and the seats chosen on that flight (FLT-28) are freed. One change at a time per booking.',
    ].join('\n\n'),
  })
  @ApiBody({ type: ChangeFlightDto })
  @ApiOkResponse({ type: FlightChangeResponseDto })
  @ApiBadRequestResponse({
    description: `The id or \`newFlightId\` is not a valid id; "${SEGMENT_INDEX_REQUIRED_MESSAGE}", or \`segmentIndex\` is not a segment of the booking; "${SAME_FLIGHT_MESSAGE}"; the new flight flies another route; "${OUTBOUND_AFTER_RETURN_MESSAGE}" or "${RETURN_TOO_EARLY_MESSAGE}"; without \`dryRun: true\`, "${EXPECTED_DIFFERENCE_REQUIRED_MESSAGE}" or "${POLICIES_REQUIRED_MESSAGE}"; or another field was sent (the cabin, the price and the status are never sent)`,
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user; "${FLIGHT_NOT_FOUND_MESSAGE}" or the new flight has no booked cabin`,
  })
  @ApiConflictResponse({
    description: `"${CHANGE_NOT_CONFIRMED_MESSAGE}", "${CHANGE_DEPARTED_MESSAGE}" (also when the flight no longer exists), "${FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE}", "${FLIGHT_NOT_BOOKABLE_MESSAGE}" (the new flight), "${NOT_ENOUGH_SEATS_MESSAGE}", "${CHANGE_AGE_GROUP_MESSAGE}", "${CHANGE_BAGS_MESSAGE}", "${CHANGE_DIFFERENCE_CHANGED_MESSAGE}", "${CHANGE_IN_PROGRESS_MESSAGE}", "${CHANGE_REFUND_TOO_LARGE_MESSAGE}" or "${CHANGE_BOOKING_CHANGED_MESSAGE}"`,
  })
  change(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeFlightDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightChangeResponseDto> {
    return this.changes.change(id, userId, dto);
  }
}
