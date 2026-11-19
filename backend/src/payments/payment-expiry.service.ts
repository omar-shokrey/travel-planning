import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { PaymentStatus } from './enums/payment-status.enum';
import { Payment } from './models/payment.schema';
import { PAYMENT_EXPIRY_BATCH_SIZE } from './payments.constants';
import { StripeGateway } from './stripe.gateway';

const OPEN = [PaymentStatus.RequiresPayment, PaymentStatus.Failed];

/**
 * PAY-01: when the hold of a booking ends, its PaymentIntent is cancelled, so
 * a card can no longer be charged for a booking whose seats or rooms were
 * released. The job runs every minute, next to the booking expiry jobs
 * (FLT-22, HTL-18).
 *
 * Stripe is called first. If Stripe refuses (the payment just succeeded), the
 * payment is left alone: the webhook will report the success. Only when Stripe
 * cancelled does the payment become `cancelled`, with an update that matches
 * only a payment that is still open.
 */
@Injectable()
export class PaymentExpiryService {
  private readonly logger = new Logger(PaymentExpiryService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly gateway: StripeGateway,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'payment-hold-expiry' })
  async cancelDuePaymentsJob(): Promise<void> {
    try {
      const cancelled = await this.cancelDuePayments(new Date());
      if (cancelled > 0) {
        this.logger.log(`Cancelled ${cancelled} unpaid PaymentIntent(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The payment hold-expiry job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Cancels the open payments whose hold ended at or before `now`, at most
   * PAYMENT_EXPIRY_BATCH_SIZE per run, oldest first. One failing payment is
   * logged and does not stop the others. Returns how many were cancelled.
   */
  async cancelDuePayments(now: Date): Promise<number> {
    const due = await this.payments
      .find({ status: { $in: OPEN }, holdExpiresAt: { $lte: now } })
      .sort({ holdExpiresAt: 1 })
      .limit(PAYMENT_EXPIRY_BATCH_SIZE)
      .select('stripePaymentIntentId')
      .lean()
      .exec();

    let cancelled = 0;
    for (const payment of due) {
      const id = payment._id.toString();
      if (!(await this.cancelAtStripe(id, payment.stripePaymentIntentId))) {
        continue;
      }
      try {
        const { matchedCount } = await this.payments
          .updateOne(
            { _id: payment._id, status: { $in: OPEN } },
            { $set: { status: PaymentStatus.Cancelled } },
          )
          .exec();
        if (matchedCount > 0) {
          cancelled += 1;
        }
      } catch (error) {
        this.logger.error(
          `PaymentIntent of payment ${id} was cancelled but the payment was not marked`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return cancelled;
  }

  /**
   * True when the PaymentIntent is cancelled at Stripe: now, or already
   * before. A refusal is checked by reading the intent back, because Stripe
   * also refuses to cancel an intent that is already cancelled (for example
   * when an earlier run cancelled it but could not mark the payment); without
   * this, that payment would stay open and be tried again every minute
   * forever. Any other refusal (the intent just succeeded) leaves the payment
   * alone: the webhook reports the success.
   */
  private async cancelAtStripe(
    paymentId: string,
    paymentIntentId: string,
  ): Promise<boolean> {
    try {
      await this.gateway.cancelPaymentIntent(paymentIntentId);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      try {
        const intent =
          await this.gateway.retrievePaymentIntent(paymentIntentId);
        if (intent.status === 'canceled') {
          return true;
        }
        this.logger.warn(
          `Could not cancel the PaymentIntent of payment ${paymentId} (Stripe status ${intent.status}); it is tried again: ${reason}`,
        );
      } catch {
        this.logger.warn(
          `Could not cancel or read the PaymentIntent of payment ${paymentId}; it is tried again: ${reason}`,
        );
      }
      return false;
    }
  }
}
