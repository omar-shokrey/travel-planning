import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebhookResponseDto } from './dto/payment-response.dto';
import { INVALID_SIGNATURE_MESSAGE } from './payments.constants';
import { StripeWebhookService } from './stripe-webhook.service';

/** PAY-01: where Stripe reports the outcome of a payment. */
@ApiTags('Payments')
@Controller('payments')
export class StripeWebhookController {
  constructor(private readonly webhook: StripeWebhookService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook: the payment outcome (PAY-01)',
    description: [
      'Called by Stripe, never by a user, so it has no login: **the signature is the authentication**. The `Stripe-Signature` header is checked against the raw request body with the webhook signing secret; a missing or wrong signature is 400 and nothing is changed. Locally, `stripe listen --forward-to localhost:3001/api/payments/webhook` forwards events and prints the `whsec_` secret to put in `STRIPE_WEBHOOK_SECRET`.',
      'Handled events: `payment_intent.succeeded` (the payment is verified: the amount and currency must match the stored payment, then the booking module confirms the booking while its hold is live), `payment_intent.payment_failed` (the user may retry) and `payment_intent.canceled`. Other events are accepted and ignored.',
      'The event id is remembered in `stripe_events`: the same event sent again is ignored. A failure while handling answers 500 so that Stripe sends the event again.',
    ].join('\n\n'),
  })
  @ApiHeader({
    name: 'Stripe-Signature',
    required: true,
    description: 'Stripe signature of the raw body',
  })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiBadRequestResponse({ description: `"${INVALID_SIGNATURE_MESSAGE}"` })
  @ApiServiceUnavailableResponse({
    description: 'Payments are not configured (no webhook secret)',
  })
  handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<WebhookResponseDto> {
    return this.webhook.handle(request.rawBody, signature);
  }
}
