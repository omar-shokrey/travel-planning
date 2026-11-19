import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
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
  ADULT_MIN_AGE,
  CHILD_MIN_AGE,
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_CHANGED_MESSAGE,
} from './flight-bookings.constants';
import { FlightBookingsService } from './flight-bookings.service';

/** Flight bookings of registered users (FLT-22, FLT-19). */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly flightBookings: FlightBookingsService) {}

  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'Hold seats for payment, with the passengers and their extra bags (FLT-22, FLT-19)',
    description: [
      `Registered users only. The user proceeds to payment with every passenger's full name, date of birth and passport number, and optional extra bags per passenger (FLT-19). The seats of the chosen cabin are reserved atomically, only if enough remain, and a booking is created in \`pending_payment\` status, held for ${FLIGHT_BOOKING_HOLD_MINUTES} minutes (\`holdExpiresAt\`). Requests at the same moment never hold more seats than the cabin has.`,
      `The server derives each passenger's type from the date of birth on the flight's local departure date (FLT-12): adult ${ADULT_MIN_AGE} or older, child ${CHILD_MIN_AGE} to ${ADULT_MIN_AGE - 1}, infant younger than ${CHILD_MIN_AGE}. A booking needs at least one adult and no more infants than adults; seats held = adults + children, at most ${FLIGHT_BOOKING_SEATS_MAX}. Infants take no seat and pay 10% of the fare. The fare is the cabin price at the moment the seats are held, in ${PLATFORM_CURRENCY} cents.`,
      `Extra bags: up to the airline's maximum per passenger, each at the airline's extra bag price, and a total weight of at most bags × the cabin's maxBagKg. \`baggageTotal\` is the sum of the fees and \`total\` = \`fareTotal\` + \`baggageTotal\`. The client never sends a passenger type, a price, a fee, a status, a hold time, an owner, a seat count or a reference (400).`,
      `If the payment does not succeed within the hold, a job running every minute moves the booking to \`expired\` and releases its seats. The payment (PAY-01) and the confirmation with a booking reference (FLT-23) are separate, later steps.`,
    ].join('\n\n'),
  })
  @ApiBody({
    type: HoldFlightBookingDto,
    examples: {
      oneAdult: {
        summary: 'One adult, no extra bags',
        value: {
          flightId: '6740f1c2a4b5c6d7e8f90456',
          cabin: CabinClass.Economy,
          passengers: [
            {
              fullName: 'Sara Ahmed',
              dateOfBirth: '1990-05-14',
              passportNumber: 'A12345678',
            },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: FlightBookingResponseDto,
    description: 'The seats are held and the booking waits for payment.',
  })
  @ApiBadRequestResponse({
    description:
      'A field is missing, invalid or not allowed (`errors` lists each field path, such as `passengers.1.dateOfBirth`, with its messages; values are never repeated): a bad flightId or cabin; a name, date of birth or passport number that breaks its rule; a date of birth in the future or more than 120 years back; the same passport number twice; no adult, more infants than adults or more than 9 seats on the departure date; extra bags from an airline that sells none, above its maximum or heavier than bags × the cabin maxBagKg; or a server-controlled field such as `type`, `price` or `status`.',
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
    description: `"${FLIGHT_NOT_BOOKABLE_MESSAGE}" (cancelled or departed, or its departure time has passed), "${NOT_ENOUGH_SEATS_MESSAGE}", or "${FLIGHT_CHANGED_MESSAGE}" (its departure date or bag weight was edited while booking). Nothing stays held.`,
  })
  hold(
    @Body() dto: HoldFlightBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingResponseDto> {
    return this.flightBookings.hold(userId, dto);
  }
}
