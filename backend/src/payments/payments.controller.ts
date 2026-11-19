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
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  PaymentIntentResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';
import {
  ALREADY_PAID_MESSAGE,
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  PAYMENT_CANCELLED_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from './payments.constants';
import { PaymentsService } from './payments.service';

/** PAY-01: paying a booking with Stripe in test mode. */
@ApiTags('Payments')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({
  description:
    'Only a registered user (role `user`) pays; administrators and moderators cannot',
})
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Start the payment of a booking (PAY-01)',
    description: [
      'Registered users only, for their own booking. The body names the booking (`bookingType` and `bookingId`) and nothing else: **the amount and the currency are always the booking total**, never sent by the client.',
      'The booking must be waiting for payment, its hold must be live and its policies must be accepted (`POST /api/bookings/:type/:id/accept-policies`, PAY-02). Stripe test mode creates a PaymentIntent and the answer carries its `clientSecret`: the frontend confirms the payment with Stripe Elements, so **card details never reach this backend**. Only the Stripe payment id, the amount, the currency and the status are stored.',
      '**The booking is not confirmed by this call.** It is confirmed only after the Stripe webhook (`POST /api/payments/webhook`) reports that the PaymentIntent succeeded. A booking has one payment: calling again while it waits for the card returns the same PaymentIntent; if the last attempt failed, use `POST /api/payments/:id/retry`. When the hold ends, the PaymentIntent is cancelled.',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: PaymentIntentResponseDto })
  @ApiBadRequestResponse({
    description:
      '`bookingType` is not `flight` or `hotel`, `bookingId` is not a valid id, or a field that is not allowed was sent (such as `amount`). `errors` lists each field.',
  })
  @ApiNotFoundResponse({
    description:
      '"Booking not found": no such booking, or it belongs to another user',
  })
  @ApiConflictResponse({
    description: `"${NOT_WAITING_FOR_PAYMENT_MESSAGE}", "${HOLD_EXPIRED_MESSAGE}", "${POLICIES_NOT_ACCEPTED_MESSAGE}", "${ALREADY_PAID_MESSAGE}", "${PAYMENT_FAILED_MESSAGE}" or "${PAYMENT_CANCELLED_MESSAGE}". Stripe is not called.`,
  })
  @ApiBadGatewayResponse({
    description: 'Stripe could not be reached. Try again.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Payments are not configured (no Stripe key)',
  })
  start(
    @Body() dto: CreatePaymentDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaymentIntentResponseDto> {
    return this.payments.start(userId, dto);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Retry a failed payment (PAY-01)',
    description: [
      'Registered users only, for their own payment. After a failed attempt the user may retry until the hold ends: the payment goes back to `requires_payment` and the answer carries the **same** PaymentIntent and its `clientSecret`, to confirm again with Stripe Elements.',
      'The booking must still be waiting for payment with a live hold. A payment that already succeeded or was cancelled cannot be retried. A payment that still waits for the card is returned unchanged.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: PaymentIntentResponseDto })
  @ApiBadRequestResponse({ description: '`id` is not a valid id' })
  @ApiNotFoundResponse({
    description: `"${PAYMENT_NOT_FOUND_MESSAGE}": no such payment, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${ALREADY_PAID_MESSAGE}", "${PAYMENT_CANCELLED_MESSAGE}", "${NOT_WAITING_FOR_PAYMENT_MESSAGE}", "${HOLD_EXPIRED_MESSAGE}" or "${POLICIES_NOT_ACCEPTED_MESSAGE}"`,
  })
  @ApiBadGatewayResponse({
    description: 'Stripe could not be reached. Try again.',
  })
  retry(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<PaymentIntentResponseDto> {
    return this.payments.retry(id, userId);
  }

  @Get(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Show the status of a payment (PAY-01)',
    description:
      'Registered users only, for their own payment: `requires_payment`, `succeeded`, `failed` or `cancelled`, with the amount and currency. It never contains the client secret.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: '`id` is not a valid id' })
  @ApiNotFoundResponse({
    description: `"${PAYMENT_NOT_FOUND_MESSAGE}": no such payment, or it belongs to another user (a user never learns that someone else's payment exists)`,
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.findOne(id, userId);
  }
}
