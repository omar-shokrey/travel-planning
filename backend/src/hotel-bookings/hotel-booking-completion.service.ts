import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { todayUtc } from '../hotels/room-dates';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HOTEL_BOOKING_COMPLETION_BATCH } from './hotel-bookings.constants';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * HTL-23 and GEN-11: a Confirmed reservation becomes Completed once its
 * check-out date has passed (UTC).
 */
@Injectable()
export class HotelBookingCompletionService {
  private readonly logger = new Logger(HotelBookingCompletionService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
  ) {}

  /** Runs every hour. An error is logged and the next run tries again. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'hotel-booking-completion' })
  async run(): Promise<void> {
    try {
      const completed = await this.completeStays(todayUtc());
      if (completed > 0) {
        this.logger.log(`Completed ${completed} hotel reservations`);
      }
    } catch (error) {
      this.logger.error(
        'Could not complete finished hotel reservations',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Completes the Confirmed reservations whose check-out date is before
   * `today`, at most one batch per call, and returns how many. Each update
   * matches only a reservation that is still Confirmed, so one cancelled in
   * the meantime stays cancelled.
   */
  async completeStays(today: string): Promise<number> {
    const due = await this.bookings
      .find({
        status: HotelBookingStatus.Confirmed,
        checkOut: { $lt: today },
      })
      .select('_id')
      .sort({ checkOut: 1 })
      .limit(HOTEL_BOOKING_COMPLETION_BATCH)
      .lean()
      .exec();

    let completed = 0;
    for (const { _id } of due) {
      const result = await this.bookings
        .updateOne(
          {
            _id,
            status: HotelBookingStatus.Confirmed,
            checkOut: { $lt: today },
          },
          { $set: { status: HotelBookingStatus.Completed } },
        )
        .exec();
      completed += result.modifiedCount;
    }
    return completed;
  }
}
