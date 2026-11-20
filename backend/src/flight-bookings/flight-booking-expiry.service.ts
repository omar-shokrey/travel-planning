import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FLIGHT_BOOKING_EXPIRY_BATCH_SIZE } from './flight-bookings.constants';
import { FlightSeatsService } from './flight-seats.service';
import { FlightBooking } from './models/flight-booking.schema';

/**
 * FLT-22: a booking whose payment did not succeed within its hold becomes
 * `expired` and its seats are released, by a job that runs every minute.
 *
 * For each due booking the status changes first, with an update that matches
 * only a booking still `pending_payment` whose hold has ended; the seats are
 * released only when that update matched. So a booking confirmed in between
 * (FLT-23) is never released, and a booking that another run already expired
 * is never released twice. If a release fails after the status changed, it
 * is logged and `heldSeats` stays one booking too high until it is recomputed
 * from the bookings (the counters are caches, see the spec).
 */
@Injectable()
export class FlightBookingExpiryService {
  private readonly logger = new Logger(FlightBookingExpiryService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly seatAssignments: FlightSeatsService,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'flight-booking-hold-expiry' })
  async expireDueHoldsJob(): Promise<void> {
    try {
      const expired = await this.expireDueHolds(new Date());
      if (expired > 0) {
        this.logger.log(`Expired ${expired} unpaid flight booking hold(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The flight booking hold-expiry job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Expires the `pending_payment` bookings whose hold ended at or before
   * `now`, at most FLIGHT_BOOKING_EXPIRY_BATCH_SIZE per run, oldest first,
   * and releases their seats, held and chosen (FLT-28). One failing booking
   * is logged and does not stop the others. Returns how many bookings this
   * run expired.
   */
  async expireDueHolds(now: Date): Promise<number> {
    const due = await this.bookings
      .find({
        status: FlightBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: now },
      })
      .sort({ holdExpiresAt: 1 })
      .limit(FLIGHT_BOOKING_EXPIRY_BATCH_SIZE)
      .select('segments')
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
              status: FlightBookingStatus.PendingPayment,
              holdExpiresAt: { $lte: now },
            },
            { $set: { status: FlightBookingStatus.Expired } },
          )
          .exec();
        matched = matchedCount > 0;
      } catch (error) {
        this.logger.error(
          `Could not expire flight booking ${id}`,
          error instanceof Error ? error.stack : error,
        );
        continue;
      }
      // Confirmed or already expired by another run: its seats are not ours to release.
      if (!matched) continue;
      expired += 1;

      for (const segment of booking.segments) {
        try {
          await this.seatHolds.release(
            segment.flightId,
            segment.cabin,
            segment.seatsReserved,
          );
        } catch (error) {
          this.logger.error(
            `Flight booking ${id} expired but its ${segment.seatsReserved} ${segment.cabin} seat(s) of flight ${segment.flightId.toString()} were not released. Recompute heldSeats from the bookings.`,
            error instanceof Error ? error.stack : error,
          );
        }
      }
      // FLT-28: a booking waiting for payment cannot choose seats, so this
      // frees nothing today; it keeps the rule "no booking that stopped
      // needing its seats holds any" true whatever the route allows.
      try {
        await this.seatAssignments.releaseBooking(booking._id);
      } catch (error) {
        this.logger.error(
          `Flight booking ${id} expired but its chosen seats were not freed`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return expired;
  }
}
