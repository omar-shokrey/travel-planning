import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { EMAIL_NOT_VERIFIED_MESSAGE } from '../auth/auth.constants';
import { RequireVerifiedEmail } from '../auth/decorators/require-verified-email.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  NOT_ENOUGH_SEATS_MESSAGE,
  cabinNotOnFlightMessage,
} from '../flights/flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import {
  FlightBookingCancellationPreviewDto,
  FlightBookingCancellationResponseDto,
} from './dto/flight-booking-cancellation-response.dto';
import { FlightBookingDetailsResponseDto } from './dto/flight-booking-details-response.dto';
import { FlightBookingListItemResponseDto } from './dto/flight-booking-list-item-response.dto';
import { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import {
  ADULT_MIN_AGE,
  CHILD_MIN_AGE,
  DEPARTED_MESSAGE,
  E_TICKET_NOT_CONFIRMED_MESSAGE,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_BOOKING_SEATS_MAX,
  FLIGHT_CHANGED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './flight-bookings.constants';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingETicketService } from './flight-booking-e-ticket.service';
import { FlightBookingListService } from './flight-booking-list.service';
import {
  BOOKING_NOT_FOUND_MESSAGE,
  FlightBookingsService,
} from './flight-bookings.service';

/** FLT-12(a): the Swagger example of a round trip, for the hold and the summary. */
const ROUND_TRIP_EXAMPLE = {
  flightId: '6740f1c2a4b5c6d7e8f90456',
  cabin: CabinClass.Economy,
  returnFlightId: '6740f1c2a4b5c6d7e8f90789',
  returnCabin: CabinClass.Business,
  passengers: [
    {
      fullName: 'Sara Ahmed',
      dateOfBirth: '1990-05-14',
      passportNumber: 'A12345678',
      returnExtraBags: { bags: 1, weightKg: 20 },
    },
    {
      fullName: 'Omar Ahmed',
      dateOfBirth: '2026-01-10',
      passportNumber: 'B98765432',
    },
  ],
};

/** Flight bookings of registered users (FLT-22, FLT-19, FLT-21, FLT-12, FLT-23, FLT-25, FLT-26). */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly flightBookings: FlightBookingsService,
    private readonly eTickets: FlightBookingETicketService,
    private readonly cancellations: FlightBookingCancellationService,
    private readonly lists: FlightBookingListService,
  ) {}

  @Get()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'List my flight bookings: upcoming, past or cancelled (FLT-25)',
    description: [
      'Registered users only, their own bookings. `group` picks one list, a page at a time:',
      '- `upcoming` (the default): confirmed, or waiting for payment while the hold lasts, and a flight of it has not departed yet; soonest departure first.',
      '- `past`: completed, or confirmed with every flight departed; latest departure first.',
      '- `cancelled`: cancelled by the user (FLT-26) or the airline (FLT-06); latest cancellation first.',
      "An expired hold (never paid) is in no list. Each item shows the reference, every flight with its local times (GEN-06), the cabin and seats, the passengers' names and types, the total and the status. Open `GET /api/flight-bookings/{id}` for the full details.",
    ].join('\n\n'),
  })
  @ApiPaginatedResponse(FlightBookingListItemResponseDto)
  @ApiBadRequestResponse({
    description:
      'A bad `group`, `page` or `limit` (`errors` lists each field), or another query parameter',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  list(
    @Query() query: ListFlightBookingsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<FlightBookingListItemResponseDto>> {
    return this.lists.list(userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  // ACC-02: an account whose email is not verified cannot book.
  @RequireVerifiedEmail()
  @ApiOperation({
    summary:
      'Show the booking summary before payment (FLT-21), one-way or round trip (FLT-12)',
    description: [
      'Registered users only (a guest gets 401 and logs in first, ACC-10). The body is exactly the body of `POST /api/flight-bookings/hold`: the flight, the cabin and every passenger with their optional extra bags. It is a POST so that names, dates of birth and passport numbers never go into a URL.',
      `The answer is the summary of what would be booked: the flight with its local times (GEN-06), the airline, each passenger with the type derived from the date of birth, their fare (infants 10%) and bag fee, the baggage allowance of the cabin and the airline's extra-bag rule, and \`fareTotal\`, \`baggageTotal\` and \`total\` in ${PLATFORM_CURRENCY} cents. The checks, their order, their messages and the prices are those of the hold, so both give the same totals for the same input and the same cabin price.`,
      'FLT-12(a): with `returnFlightId` and `returnCabin` it is the summary of a round trip. The top-level flight, airline, cabin, passengers and baggage are the outbound flight; `returnTrip` has the return flight, its airline and cabin, what each passenger pays on it and its baggage rule; `fareTotal`, `baggageTotal` and `total` cover both flights. One-way, `returnTrip` is `null`.',
      '**Nothing is held and nothing is saved** (200, not 201). 409 "Not enough seats left" is only informative here: the hold checks the seats again atomically, and the seats or the price can still change before it. Call `/hold` to proceed to payment.',
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
      roundTrip: {
        summary: 'Round trip (FLT-12): an adult and an infant, extra bags back',
        value: ROUND_TRIP_EXAMPLE,
      },
    },
  })
  @ApiOkResponse({
    type: FlightBookingSummaryResponseDto,
    description: 'The summary. Nothing was held or saved.',
  })
  @ApiBadRequestResponse({
    description:
      'The same 400 as the hold: a field is missing, invalid or not allowed (`errors` lists each field path); no adult, more infants than adults or more than 9 seats on the departure date; extra bags the airline does not sell, above its maximum or too heavy; a round trip whose return flight does not fly the route back, leaves before the outbound flight arrives, misses its cabin, or with an infant who is 2 or older on the return date; returnExtraBags without a return flight; or a server-controlled field such as `type` or `price`.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: `Only a registered user (role \`user\`) can book; administrators and moderators cannot. ACC-02: also "${EMAIL_NOT_VERIFIED_MESSAGE}" while the email of the account is not verified.`,
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}" (also for a flight of a deactivated airline), or "${cabinNotOnFlightMessage(CabinClass.Business)}" (the cabin sent is named). For the return flight of a round trip the same answers start with "Return flight: ".`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_BOOKABLE_MESSAGE}" (cancelled or departed, or its departure time has passed), or "${NOT_ENOUGH_SEATS_MESSAGE}" right now. For the return flight of a round trip the same answers start with "Return flight: ". Nothing is held.`,
  })
  summarise(
    @Body() dto: HoldFlightBookingDto,
  ): Promise<FlightBookingSummaryResponseDto> {
    return this.flightBookings.summarise(dto);
  }

  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.User)
  // ACC-02: an account whose email is not verified cannot book.
  @RequireVerifiedEmail()
  @ApiOperation({
    summary:
      'Hold seats for payment, with the passengers and their extra bags (FLT-22, FLT-19), one-way or round trip (FLT-12)',
    description: [
      `Registered users only. The user proceeds to payment with every passenger's full name, date of birth and passport number, and optional extra bags per passenger (FLT-19). The seats of the chosen cabin are reserved atomically, only if enough remain, and a booking is created in \`pending_payment\` status, held for ${FLIGHT_BOOKING_HOLD_MINUTES} minutes (\`holdExpiresAt\`). Requests at the same moment never hold more seats than the cabin has.`,
      `The server derives each passenger's type from the date of birth on the flight's local departure date (FLT-12): adult ${ADULT_MIN_AGE} or older, child ${CHILD_MIN_AGE} to ${ADULT_MIN_AGE - 1}, infant younger than ${CHILD_MIN_AGE}. A booking needs at least one adult and no more infants than adults; seats held = adults + children, at most ${FLIGHT_BOOKING_SEATS_MAX}. Infants take no seat and pay 10% of the fare. The fare is the cabin price at the moment the seats are held, in ${PLATFORM_CURRENCY} cents.`,
      `Extra bags: up to the airline's maximum per passenger, each at the airline's extra bag price, and a total weight of at most bags × the cabin's maxBagKg. \`baggageTotal\` is the sum of the fees and \`total\` = \`fareTotal\` + \`baggageTotal\`. The client never sends a passenger type, a price, a fee, a status, a hold time, an owner, a seat count or a reference (400).`,
      `FLT-12(a), round trip: add \`returnFlightId\` and \`returnCabin\` (from the \`return\` page of a round-trip search), and optional \`returnExtraBags\` per passenger. The return flight must fly the outbound route reversed and leave after the outbound flight arrives. Both flights are held in the same request for the same passengers and saved as **one booking with two segments** (outbound, then return), so it has one payment, one reference and one hold time; if either flight cannot be held, nothing stays held. Each passenger's type is the one of the outbound date: an infant who is ${CHILD_MIN_AGE} or older on the return date needs a seat there, so that round trip is refused (book two one-way trips). Answers about the return flight start with "Return flight: ". The booking is cancelled as a whole, with the outbound segment's cancellation tiers.`,
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
      roundTrip: {
        summary: 'Round trip (FLT-12): an adult and an infant, extra bags back',
        value: ROUND_TRIP_EXAMPLE,
      },
    },
  })
  @ApiCreatedResponse({
    type: FlightBookingResponseDto,
    description: 'The seats are held and the booking waits for payment.',
  })
  @ApiBadRequestResponse({
    description:
      'A field is missing, invalid or not allowed (`errors` lists each field path, such as `passengers.1.dateOfBirth`, with its messages; values are never repeated): a bad flightId or cabin; a name, date of birth or passport number that breaks its rule; a date of birth in the future or more than 120 years back; the same passport number twice; no adult, more infants than adults or more than 9 seats on the departure date; extra bags from an airline that sells none, above its maximum or heavier than bags × the cabin maxBagKg; for a round trip (FLT-12), a returnFlightId without returnCabin or the other way round, a return flight that does not fly the outbound route reversed or leaves before the outbound flight arrives, an infant who is 2 or older on the return date, or returnExtraBags without a return flight; or a server-controlled field such as `type`, `price` or `status`.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: `Only a registered user (role \`user\`) can book; administrators and moderators cannot. ACC-02: also "${EMAIL_NOT_VERIFIED_MESSAGE}" while the email of the account is not verified.`,
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}" (also for a flight of a deactivated airline), or "${cabinNotOnFlightMessage(CabinClass.Business)}" (the cabin sent is named). For the return flight of a round trip the same answers start with "Return flight: ".`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_BOOKABLE_MESSAGE}" (cancelled or departed, or its departure time has passed), "${NOT_ENOUGH_SEATS_MESSAGE}", or "${FLIGHT_CHANGED_MESSAGE}" (its departure date or bag weight was edited while booking, or a round trip's return no longer leaves after the outbound arrives). For the return flight of a round trip the answers start with "Return flight: ". Nothing stays held.`,
  })
  hold(
    @Body() dto: HoldFlightBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingResponseDto> {
    return this.flightBookings.hold(userId, dto);
  }

  @Get(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Show the full details of one of my flight bookings (FLT-25)',
    description:
      'Registered users only, their own booking, in any status. Everything the hold returned (each passenger with the passport number and extra bags, the fares and totals in USD cents), the full flight of each segment with its local times (GEN-06), when the policies were accepted (PAY-02) and, once cancelled, when, by whom (`user` or `provider`), the refund percent and the refund (PAY-03).',
  })
  @ApiOkResponse({ type: FlightBookingDetailsResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  details(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingDetailsResponseDto> {
    return this.lists.details(id, userId);
  }

  @Get(':id/e-ticket')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Download the e-ticket of a confirmed booking (FLT-23)',
    description:
      'Registered users only, for their own booking, once it is confirmed (after the payment succeeded, PAY-01). A PDF with the booking reference, each flight (airline, flight number, route, local departure and arrival with the time zones), the cabin and seats, each passenger with their type and a masked passport number (last 3 characters), the baggage, and the total paid in USD. The file name carries the reference.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The e-ticket PDF',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${E_TICKET_NOT_CONFIRMED_MESSAGE}": the booking is waiting for payment, expired, cancelled or completed (only a confirmed booking has one)`,
  })
  async eTicket(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.eTickets.eTicket(id, userId);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: pdf.length,
    });
  }

  @Get(':id/cancel')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'View the refund of cancelling a booking (FLT-26)',
    description: [
      'Registered users only, for their own confirmed booking, before its first flight departs. **Nothing changes**: this shows what `POST /api/flight-bookings/{id}/cancel` would do now, so the user can confirm it.',
      `\`daysRemaining\` is the number of whole days left before the departure (UTC). \`refundPercent\` comes from the airline's cancellation tiers copied into the booking when it was held (FLT-09): the tier with the highest \`daysBefore\` that is at most \`daysRemaining\`, or 0 if none. \`refundAmount\` = \`total\` × \`refundPercent\` / 100, rounded to the cent, in ${PLATFORM_CURRENCY} cents. A round trip is cancelled as a whole, with the outbound flight's tiers and departure.`,
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: FlightBookingCancellationPreviewDto,
    description: 'The refund the user would get now. Nothing changed.',
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${NOT_CANCELLABLE_MESSAGE}" (waiting for payment, expired, already cancelled or completed), "${DEPARTED_MESSAGE}", or "${FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE}" (FLT-06 cancels it with a full refund)`,
  })
  cancellationPreview(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingCancellationPreviewDto> {
    return this.cancellations.preview(id, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Cancel a booking and get the refund (FLT-26)',
    description: [
      'Registered users only, for their own confirmed booking, before its first flight departs. First view the refund with `GET /api/flight-bookings/{id}/cancel`, then send the `refundPercent` it showed as `expectedRefundPercent`. If the refund changed in between (a tier boundary passed), the answer is 409 and nothing changes: view it again and confirm the new one.',
      'The booking becomes `cancelled` with `cancelledAt`, `cancelledBy: user` and the `refundPercent` (GEN-11: only a confirmed booking can be cancelled, and only once, even with two requests at the same moment). The seats of every flight of the booking go back to the inventory. The refund is then created through Stripe (PAY-03): `refund` is its summary, or `null` when the refund is 0%. A refund that Stripe has not accepted yet stays `pending` and is retried; it never undoes the cancellation.',
    ].join('\n\n'),
  })
  @ApiBody({
    type: CancelFlightBookingDto,
    examples: {
      confirm: {
        summary: 'Confirm the 50% refund that was shown',
        value: { expectedRefundPercent: 50 },
      },
    },
  })
  @ApiOkResponse({
    type: FlightBookingCancellationResponseDto,
    description: 'The booking is cancelled and the refund is created.',
  })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, or `expectedRefundPercent` is missing, not a whole number, or not between 0 and 100 (`errors` lists it), or another field was sent',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such booking, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${NOT_CANCELLABLE_MESSAGE}" (waiting for payment, expired, already cancelled or completed), "${DEPARTED_MESSAGE}", "${FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE}" (FLT-06 cancels it with a full refund), or "${REFUND_CHANGED_MESSAGE}". Nothing changed.`,
  })
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelFlightBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightBookingCancellationResponseDto> {
    return this.cancellations.cancel(id, userId, dto.expectedRefundPercent);
  }
}
