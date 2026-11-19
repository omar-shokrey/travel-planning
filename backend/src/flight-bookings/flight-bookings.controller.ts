import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  NOT_ENOUGH_SEATS_MESSAGE,
  cabinNotOnFlightMessage,
} from '../flights/flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import {
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_BOOKING_SEATS_MAX,
} from './flight-bookings.constants';
import { FlightBookingsService } from './flight-bookings.service';

/** Flight bookings of registered users (FLT-22). */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly flightBookings: FlightBookingsService) {}

  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Hold seats for payment (FLT-22)',
    description: [
      `Registered users only. The user proceeds to payment: the seats of the chosen cabin are reserved atomically, only if enough remain, and a booking is created in \`pending_payment\` status, held for ${FLIGHT_BOOKING_HOLD_MINUTES} minutes (\`holdExpiresAt\`). Requests at the same moment never hold more seats than the cabin has.`,
      `Seats held = adults + children, at most ${FLIGHT_BOOKING_SEATS_MAX}; at least one adult, and no more infants than adults. Infants take no seat and pay 10% of the fare. The fare is the cabin price at the moment the seats are held, in ${PLATFORM_CURRENCY} cents; \`total\` equals \`fareTotal\` until baggage is added (FLT-19). The client never sends a price, a status, a hold time, an owner, a seat count or a reference (400).`,
      `If the payment does not succeed within the hold, a job running every minute moves the booking to \`expired\` and releases its seats. The payment (PAY-01) and the confirmation with a booking reference (FLT-23) are separate, later steps.`,
    ].join('\n\n'),
  })
  @ApiCreatedResponse({
    type: FlightBookingResponseDto,
    description: 'The seats are held and the booking waits for payment.',
  })
  @ApiBadRequestResponse({
    description:
      'A field is missing, invalid or not allowed: a bad flightId or cabin, no adult, more infants than adults, more than 9 seats, or a server-controlled field such as `price` or `status`. `errors` lists each field with its messages.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'Only a registered user (role `user`) can book; administrators and moderators cannot',
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}" (also for a flight of a deactivated airline), or "${cabinNotOnFlightMessage(CabinClass.Business)}" (the cabin sent is named)`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_BOOKABLE_MESSAGE}" (cancelled or departed, or its departure time has passed), or "${NOT_ENOUGH_SEATS_MESSAGE}". Nothing was held.`,
  })
  hold(
    @Body() dto: HoldFlightBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingResponseDto> {
    return this.flightBookings.hold(userId, dto);
  }
}
