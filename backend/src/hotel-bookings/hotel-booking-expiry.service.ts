import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HOTEL_BOOKING_EXPIRY_BATCH } from './hotel-bookings.constants';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * HTL-18 and GEN-11: a Pending Payment reservation whose hold has run out
 * becomes Expired, and its rooms are released.
 */
@Injectable()
export class HotelBookingExpiryService {
  private readonly logger = new Logger(HotelBookingExpiryService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
  ) {}

  /** Runs every minute. An error is logged and the next run tries again. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'hotel-booking-hold-expiry' })
  async run(): Promise<void> {
    try {
      const expired = await this.expireHolds(new Date());
      if (expired > 0) {
        this.logger.log(`Expired ${expired} unpaid hotel reservations`);
      }
    } catch (error) {
      this.logger.error(
        'Could not expire unpaid hotel reservations',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Expires the reservations still in Pending Payment whose hold ended at or
   * before `now`, at most one batch per call, and returns how many it
   * expired. The update matches only a reservation that is still Pending
   * Payment, so one that the payment confirmed in the meantime is left alone
   * and keeps its rooms.
   */
  async expireHolds(now: Date): Promise<number> {
    const due = await this.bookings
      .find({
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .sort({ holdExpiresAt: 1 })
      .limit(HOTEL_BOOKING_EXPIRY_BATCH)
      .lean()
      .exec();

    let expired = 0;
    for (const { _id } of due) {
      const result = await this.bookings
        .updateOne(
          {
            _id,
            status: HotelBookingStatus.PendingPayment,
            holdExpiresAt: { $lte: now },
          },
          { $set: { status: HotelBookingStatus.Expired } },
        )
        .exec();
      if (result.modifiedCount === 1) {
        await this.roomHolds.release(_id);
        expired += 1;
      }
    }
    return expired;
  }
}
