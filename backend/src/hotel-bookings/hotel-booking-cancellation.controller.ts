import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
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
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CancelHotelBookingDto } from './dto/cancel-hotel-booking.dto';
import {
  HotelBookingCancellationPreviewDto,
  HotelBookingCancellationResponseDto,
} from './dto/hotel-booking-cancellation-response.dto';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';
import {
  CHECK_IN_REACHED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';

/** HTL-21: cancel a hotel reservation. */
@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingCancellationController {
  constructor(
    private readonly cancellations: HotelBookingCancellationService,
  ) {}

  @Get(':id/cancel')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'View the refund of cancelling a reservation (HTL-21)',
    description: [
      'Registered users only, for their own confirmed reservation, before its check-in date. **Nothing changes**: this shows what `POST /api/hotel-bookings/{id}/cancel` would do today, so the user can confirm it.',
      `\`daysRemaining\` is the number of whole days from today to the check-in date, both UTC dates (the hotel's time zone is not stored). \`refundPercent\` comes from the hotel's cancellation tiers copied into the reservation when it was made (HTL-10): the tier with the highest \`daysBefore\` that is at most \`daysRemaining\`, or 0 if none. \`refundAmount\` = \`total\` × \`refundPercent\` / 100, rounded to the cent, on the full total of every room, in ${PLATFORM_CURRENCY} cents.`,
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: HotelBookingCancellationPreviewDto,
    description: 'The refund the user would get now. Nothing changed.',
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such reservation, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${NOT_CANCELLABLE_MESSAGE}" (waiting for payment, expired, already cancelled or completed), or "${CHECK_IN_REACHED_MESSAGE}" (on or after the check-in date)`,
  })
  cancellationPreview(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<HotelBookingCancellationPreviewDto> {
    return this.cancellations.preview(id, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Cancel a reservation and get the refund (HTL-21)',
    description: [
      'Registered users only, for their own confirmed reservation, as a whole (every room), before its check-in date. First view the refund with `GET /api/hotel-bookings/{id}/cancel`, then send the `refundPercent` it showed as `expectedRefundPercent`. If the refund changed in between (a tier boundary passed), the answer is 409 and nothing changes: view it again and confirm the new one.',
      'The reservation becomes `cancelled` with `cancelledAt`, `cancelledBy: user` and the `refundPercent` (GEN-11: only a confirmed reservation can be cancelled, and only once, even with two requests at the same moment). Every room is free again for those dates. The refund is then created through Stripe (PAY-03): `refund` is its summary, or `null` when the refund is 0%. A refund that Stripe has not accepted yet stays `pending` and is retried; it never undoes the cancellation.',
    ].join('\n\n'),
  })
  @ApiBody({
    type: CancelHotelBookingDto,
    examples: {
      confirm: {
        summary: 'Confirm the 50% refund that was shown',
        value: { expectedRefundPercent: 50 },
      },
    },
  })
  @ApiOkResponse({
    type: HotelBookingCancellationResponseDto,
    description: 'The reservation is cancelled and the refund is created.',
  })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, or `expectedRefundPercent` is missing, not a whole number, or not between 0 and 100 (`errors` lists it), or another field was sent',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such reservation, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${NOT_CANCELLABLE_MESSAGE}" (waiting for payment, expired, already cancelled or completed), "${CHECK_IN_REACHED_MESSAGE}", or "${REFUND_CHANGED_MESSAGE}". Nothing changed.`,
  })
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelHotelBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<HotelBookingCancellationResponseDto> {
    return this.cancellations.cancel(id, userId, dto.expectedRefundPercent);
  }
}
