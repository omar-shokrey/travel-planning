import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { RefundStatus } from './enums/refund-status.enum';
import { Refund } from './models/refund.schema';
import {
  REFUND_RECOVERY_BATCH_SIZE,
  REFUND_RECOVERY_MAX_AGE_MS,
  REFUND_RECOVERY_MIN_AGE_MS,
} from './refunds.constants';
import { RefundsService } from './refunds.service';

/**
 * PAY-03: sends again the refunds Stripe could not take (Stripe was down or
 * not configured when the cancellation happened): `pending`, no Stripe id,
 * created more than a minute ago (younger ones are still being sent) and less
 * than 12 hours ago. The idempotency key is the booking's, and Stripe keeps it
 * for 24 hours, so a retry inside that window can never refund twice. Older
 * refunds are only reported as an error for the team, never sent
 * automatically.
 */
@Injectable()
export class RefundRecoveryService {
  private readonly logger = new Logger(RefundRecoveryService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    private readonly refundsService: RefundsService,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'refund-recovery' })
  async recoverJob(): Promise<void> {
    try {
      const sent = await this.recover(new Date());
      if (sent > 0) {
        this.logger.log(`Sent ${sent} pending refund(s) to Stripe again`);
      }
    } catch (error) {
      this.logger.error(
        'The refund recovery job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Sends again at most REFUND_RECOVERY_BATCH_SIZE refunds, oldest first.
   * One failing refund is logged and does not stop the others. Returns how
   * many Stripe took (they now have a Stripe id).
   */
  async recover(now: Date): Promise<number> {
    const due = await this.refunds
      .find({
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
        createdAt: {
          $lte: new Date(now.getTime() - REFUND_RECOVERY_MIN_AGE_MS),
          $gt: new Date(now.getTime() - REFUND_RECOVERY_MAX_AGE_MS),
        },
      })
      .sort({ createdAt: 1 })
      .limit(REFUND_RECOVERY_BATCH_SIZE)
      .lean()
      .exec();

    let sent = 0;
    for (const refund of due) {
      try {
        const result = await this.refundsService.resubmit(refund);
        if (result.stripeRefundId) {
          sent += 1;
        }
      } catch (error) {
        this.logger.error(
          `Refund ${refund._id.toString()} could not be sent again`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    const stuck = await this.refunds
      .countDocuments({
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
        createdAt: {
          $lte: new Date(now.getTime() - REFUND_RECOVERY_MAX_AGE_MS),
        },
      })
      .exec();
    if (stuck > 0) {
      this.logger.error(
        `${stuck} refund(s) are pending for more than 12 hours without reaching Stripe. They are not sent automatically: check them by hand.`,
      );
    }
    return sent;
  }
}
