import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_CANCELLABLE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from '../flights/flights.constants';
import { FlightCancellationResponseDto } from './dto/flight-cancellation-response.dto';
import { FlightCancellationService } from './flight-cancellation.service';

/**
 * FLT-06: an airline moderator cancels a flight. The route is under
 * /api/flights (section 8 of the project description), but it lives in the
 * booking module, because most of the work is on the bookings and this
 * module already imports the flights module (not the other way round).
 */
@ApiTags('Flights')
@ApiCookieAuth()
@Controller('flights')
export class FlightCancellationController {
  constructor(private readonly cancellations: FlightCancellationService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: 'Cancel a scheduled flight (FLT-06)',
    description: [
      "The airline moderator of the flight's airline only, after confirming in the interface (this cannot be undone). The flight must be scheduled and not departed (FLT-30). It becomes `cancelled`: search no longer finds it and it can no longer be held or booked.",
      'Every **confirmed** booking with this flight (a round trip as a whole) becomes `cancelled` with `cancelledBy: provider` and a **100% refund** through Stripe (PAY-03, reason `flight_cancelled`); its seats go back and its owner gets an in-app notification (GEN-01) with the flight, the date, the reference and the refund. Every **hold waiting for payment** expires and its seats are released; a payment that arrives later is refunded in full (PAY-03).',
      'The answer is the cancelled flight with the number of bookings cancelled and holds expired. A booking the cascade could not finish is finished by an hourly job; the flight stays cancelled.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: FlightCancellationResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: `Not an airline moderator, no assigned airline, or "${FOREIGN_FLIGHT_MESSAGE}"`,
  })
  @ApiNotFoundResponse({ description: `"${FLIGHT_NOT_FOUND_MESSAGE}"` })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_CANCELLABLE_MESSAGE}" (already cancelled, departed, or its departure time has passed), or "${FLIGHT_CHANGED_MESSAGE}". Nothing changed.`,
  })
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<FlightCancellationResponseDto> {
    return this.cancellations.cancelFlight(id, userId);
  }
}
