import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  BOOKING_PAYMENT_HANDLERS,
  type BookingPaymentHandlers,
} from './booking-payment-handler';
import type { WebhookResponseDto } from './dto/payment-response.dto';
import { PaymentStatus } from './enums/payment-status.enum';
import { Payment } from './models/payment.schema';
import { StripeEvent } from './models/stripe-event.schema';
import { RefundReason } from './refunds/enums/refund-reason.enum';
import { RefundsService } from './refunds/refunds.service';
import {
  BOOKING_CONFIRMATION_UNAVAILABLE_MESSAGE,
  INVALID_SIGNATURE_MESSAGE,
} from './payments.constants';
import { StripeGateway, type GatewayEvent } from './stripe.gateway';

const MONGO_DUPLICATE_KEY = 11000;

type EventIntent = NonNullable<GatewayEvent['intent']>;

/**
 * PAY-01: the Stripe webhook. This is the only place that decides a payment
 * succeeded: the booking is confirmed only after the signature is verified and
 * Stripe reports the PaymentIntent as `succeeded`.
 *
 * - The signature is checked against the raw body first (400 otherwise).
 * - An event id already in `stripe_events` is ignored, so Stripe's retries are
 *   harmless. The id is stored AFTER the event was handled, and every step is
 *   idempotent, so a crash in between only means Stripe retries the event.
 * - A failure while handling answers 500, so Stripe sends the event again.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(StripeEvent.name) private readonly events: Model<StripeEvent>,
    private readonly gateway: StripeGateway,
    @Inject(BOOKING_PAYMENT_HANDLERS)
    private readonly handlers: BookingPaymentHandlers,
    private readonly refunds: RefundsService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResponseDto> {
    if (!rawBody || !signature) {
      throw new BadRequestException(INVALID_SIGNATURE_MESSAGE);
    }
    const event = this.gateway.constructEvent(rawBody, signature);

    if (await this.events.exists({ _id: event.id })) {
      return { received: true };
    }
    await this.process(event, new Date());
    await this.remember(event);
    return { received: true };
  }

  private async process(event: GatewayEvent, now: Date): Promise<void> {
    if (event.refund) {
      // refund.created, refund.updated, refund.failed (PAY-03): Stripe sends
      // no refund.succeeded; a success arrives as refund.updated.
      await this.refunds.applyStripeStatus(
        event.refund.id,
        event.refund.status,
      );
      return;
    }
    const intent = event.intent;
    if (!intent) {
      return;
    }
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(intent, now);
        return;
      case 'payment_intent.payment_failed':
        await this.moveTo(intent.id, PaymentStatus.Failed, [
          PaymentStatus.RequiresPayment,
        ]);
        return;
      case 'payment_intent.canceled':
        await this.moveTo(intent.id, PaymentStatus.Cancelled, [
          PaymentStatus.RequiresPayment,
          PaymentStatus.Failed,
        ]);
        return;
      default:
        // Other payment events do not change what we store.
        return;
    }
  }

  /**
   * The money arrived. The payment is marked succeeded, then the booking
   * module confirms the booking (FLT-23, HTL-17) only if its hold is still
   * live; a late payment is logged for the refund (PAY-03), never confirmed.
   */
  private async onSucceeded(intent: EventIntent, now: Date): Promise<void> {
    const payment = await this.payments
      .findOne({ stripePaymentIntentId: intent.id })
      .lean()
      .exec();
    if (!payment) {
      this.logger.warn(
        `Payment succeeded for an unknown PaymentIntent ${intent.id}`,
      );
      return;
    }
    if (
      intent.amountReceived !== payment.amount ||
      intent.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      this.logger.error(
        `Payment ${payment._id.toString()}: Stripe received ${intent.amountReceived} ${intent.currency}, expected ${payment.amount} ${payment.currency}. Not confirmed.`,
      );
      return;
    }
    if (payment.status === PaymentStatus.Cancelled) {
      this.logger.error(
        `Payment ${payment._id.toString()} succeeded after it was cancelled. It needs a refund (PAY-03).`,
      );
      return;
    }
    if (payment.status !== PaymentStatus.Succeeded) {
      await this.payments
        .updateOne(
          {
            _id: payment._id,
            status: {
              $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed],
            },
          },
          { $set: { status: PaymentStatus.Succeeded } },
        )
        .exec();
    }

    const handler = this.handlers[payment.bookingType];
    if (!handler) {
      // Not an "ignore": answering 503 keeps the event out of stripe_events,
      // so Stripe sends it again (for up to 3 days) until FLT-23 / HTL-17
      // confirm bookings. Remembering it would lose the confirmation forever.
      this.logger.error(
        `Payment ${payment._id.toString()} succeeded, but nothing confirms ${payment.bookingType} bookings yet (FLT-23, HTL-17). Stripe will send the event again.`,
      );
      throw new ServiceUnavailableException(
        BOOKING_CONFIRMATION_UNAVAILABLE_MESSAGE,
      );
    }
    const confirmed = await handler.confirmPaid(
      payment.bookingId.toString(),
      now,
    );
    if (!confirmed) {
      // PAY-03: a late payment (of a booking or of a flight change, FLT-27)
      // is refunded in full. refund() is idempotent per (bookingType,
      // bookingId), so a repeated event refunds once. An unexpected error
      // (the database) answers 500 and Stripe sends the event again.
      this.logger.warn(
        `Payment ${payment._id.toString()} succeeded after the hold of ${payment.bookingType} booking ${payment.bookingId.toString()} ended. It is refunded in full (PAY-03).`,
      );
      await this.refunds.refund({
        bookingType: payment.bookingType,
        bookingId: payment.bookingId.toString(),
        refundPercent: 100,
        reason: RefundReason.LatePayment,
      });
    }
  }

  /** A conditional update: the status only moves forward from the allowed ones. */
  private async moveTo(
    paymentIntentId: string,
    to: PaymentStatus,
    from: PaymentStatus[],
  ): Promise<void> {
    await this.payments
      .updateOne(
        { stripePaymentIntentId: paymentIntentId, status: { $in: from } },
        { $set: { status: to } },
      )
      .exec();
  }

  /** Stores the event id. Two deliveries at the same moment both succeed: the second insert is ignored. */
  private async remember(event: GatewayEvent): Promise<void> {
    try {
      await this.events.create({
        _id: event.id,
        type: event.type,
        processedAt: new Date(),
      });
    } catch (error) {
      const duplicate =
        error instanceof Error &&
        'code' in error &&
        error.code === MONGO_DUPLICATE_KEY;
      if (!duplicate) {
        throw error;
      }
    }
  }
}
