import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HOTEL_BOOKING_EXPIRY_BATCH_SIZE } from './hotel-bookings.constants';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * HTL-18: a reservation whose payment did not succeed within its hold becomes
 * `expired` and its rooms are released, by a job that runs every minute
 * (GEN-11: Pending Payment -> Expired).
 *
 * For each due reservation the status changes first, with an update that
 * matches only a reservation still `pending_payment` whose hold has ended; the
 * nights are released only when that update matched. So a reservation
 * confirmed in between (HTL-17) is never released, and one that another run
 * already expired is never released twice. A failed release is logged: its
 * nights still carry their `holdExpiresAt`, which has passed, so every query
 * already ignores them and the next hold of those nights removes them.
 */
@Injectable()
export class HotelBookingExpiryService {
  private readonly logger = new Logger(HotelBookingExpiryService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'hotel-booking-hold-expiry' })
  async expireDueHoldsJob(): Promise<void> {
    try {
      const expired = await this.expireDueHolds(new Date());
      if (expired > 0) {
        this.logger.log(`Expired ${expired} unpaid hotel reservation hold(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The hotel reservation hold-expiry job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Expires the `pending_payment` reservations whose hold ended at or before
   * `now`, at most HOTEL_BOOKING_EXPIRY_BATCH_SIZE per run, oldest first, and
   * releases their held nights. One failing reservation is logged and does
   * not stop the others. Returns how many reservations this run expired.
   */
  async expireDueHolds(now: Date): Promise<number> {
    const due = await this.bookings
      .find({
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: now },
      })
      .sort({ holdExpiresAt: 1 })
      .limit(HOTEL_BOOKING_EXPIRY_BATCH_SIZE)
      .select('_id')
      .lean()
      .exec();

    let expired = 0;
    for (const booking of due) {
      const id = booking._id.toString();
      let matched: boolean;
      try {
        const { matchedCount } = await this.bookings
          .updateOne(
            {
              _id: booking._id,
              status: HotelBookingStatus.PendingPayment,
              holdExpiresAt: { $lte: now },
            },
            { $set: { status: HotelBookingStatus.Expired } },
          )
          .exec();
        matched = matchedCount > 0;
      } catch (error) {
        this.logger.error(
          `Could not expire hotel reservation ${id}`,
          error instanceof Error ? error.stack : error,
        );
        continue;
      }
      // Confirmed or already expired by another run: its nights are not ours to release.
      if (!matched) continue;
      expired += 1;

      try {
        await this.roomHolds.release(booking._id);
      } catch (error) {
        this.logger.error(
          `Hotel reservation ${id} expired but its held nights were not released. They no longer count, because their hold has ended, and the next hold of those nights removes them.`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return expired;
  }
}
