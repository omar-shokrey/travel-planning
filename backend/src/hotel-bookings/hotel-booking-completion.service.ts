import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import type { Model } from 'mongoose';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * GEN-11: Confirmed -> Completed. A confirmed reservation is completed from
 * the day after its check-out date (UTC), by a job that runs every hour: the
 * hotel's local check-out time is not known in UTC, and a day later every
 * guest has left, so a guest still at the hotel is never completed. The
 * update matches only a reservation still `confirmed`, so a cancellation at
 * the same moment wins.
 */
@Injectable()
export class HotelBookingCompletionService {
  private readonly logger = new Logger(HotelBookingCompletionService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'hotel-booking-completion' })
  async completeJob(): Promise<void> {
    try {
      const completed = await this.completeCheckedOut(new Date());
      if (completed > 0) {
        this.logger.log(`Completed ${completed} hotel reservation(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The hotel reservation completion job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Completes every confirmed reservation whose check-out date is before
   * today (UTC) at `now`, with one conditional update on the (status,
   * checkOut) index. Returns how many it completed.
   */
  async completeCheckedOut(now: Date): Promise<number> {
    const today = DateTime.fromJSDate(now, { zone: 'utc' }).toFormat(
      'yyyy-MM-dd',
    );
    const { modifiedCount } = await this.bookings
      .updateMany(
        { status: HotelBookingStatus.Confirmed, checkOut: { $lt: today } },
        { $set: { status: HotelBookingStatus.Completed } },
      )
      .exec();
    return modifiedCount;
  }
}
