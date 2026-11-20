import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FlightChangeService } from './flight-change.service';

/**
 * FLT-27: the change job, every minute, next to the booking hold expiry
 * (FLT-22). It expires the dearer changes whose hold ended unpaid (their
 * seats go back), and finishes the changes left `applying` by a crash or a
 * refund that could not be made yet (the old seats, the chosen seats, the
 * refund of a cheaper fare). A job must never crash the app, so every error
 * is logged.
 */
@Injectable()
export class FlightChangeExpiryService {
  private readonly logger = new Logger(FlightChangeExpiryService.name);

  constructor(private readonly changes: FlightChangeService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'flight-change-job' })
  async runJob(): Promise<void> {
    await this.run(new Date());
  }

  /** One run; returns what it did. Each part's failure is logged and does not stop the other. */
  async run(now: Date): Promise<{ expired: number; finished: number }> {
    let expired = 0;
    let finished = 0;
    try {
      expired = await this.changes.expireDueHolds(now);
      if (expired > 0) {
        this.logger.log(`Expired ${expired} unpaid flight change hold(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The flight change hold-expiry failed',
        error instanceof Error ? error.stack : error,
      );
    }
    try {
      finished = await this.changes.finishStuck(now);
      if (finished > 0) {
        this.logger.log(`Finished ${finished} flight change(s) left applying`);
      }
    } catch (error) {
      this.logger.error(
        'Finishing the flight changes left applying failed',
        error instanceof Error ? error.stack : error,
      );
    }
    return { expired, finished };
  }
}
