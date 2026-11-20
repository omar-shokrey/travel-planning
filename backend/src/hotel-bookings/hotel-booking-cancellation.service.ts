import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { refundPercentFor } from '../common/cancellation-tiers';
import { CancelledBy } from '../flight-bookings/enums/cancelled-by.enum';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { todayUtc } from '../hotels/room-dates';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import { RefundsService } from '../payments/refunds/refunds.service';
import type {
  HotelBookingCancellationPreviewDto,
  HotelBookingCancellationResponseDto,
} from './dto/hotel-booking-cancellation-response.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { canHotelBookingMoveTo } from './hotel-booking-lifecycle';
import {
  CHECK_IN_REACHED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import type { HotelBookingSource } from './mappers/hotel-booking.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * Whole days from `today` to `checkIn`, both `YYYY-MM-DD` (UTC dates). The
 * dates have no time, so the difference is always a whole number: 1 the day
 * before check-in, 0 on the check-in day, negative after it.
 */
export function daysUntil(today: string, checkIn: string): number {
  return DateTime.fromISO(checkIn, { zone: 'utc' }).diff(
    DateTime.fromISO(today, { zone: 'utc' }),
    'days',
  ).days;
}

/**
 * HTL-21: a registered user cancels their own confirmed reservation as a
 * whole, before the check-in date, after viewing the refund and confirming
 * it. The reservation becomes `cancelled` (GEN-11: Confirmed -> Cancelled),
 * all its rooms are released for those dates and the refund is created
 * through Stripe (PAY-03). Partial cancellation is not supported.
 */
@Injectable()
export class HotelBookingCancellationService {
  private readonly logger = new Logger(HotelBookingCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * The refund the user would get now. Changes nothing. 404 for a
   * reservation that does not exist or is someone else's (ACC-11), 409 for
   * one that is not confirmed or whose check-in date has been reached.
   */
  async preview(
    id: string,
    userId: string,
    today: string = todayUtc(),
  ): Promise<HotelBookingCancellationPreviewDto> {
    return this.quote(await this.findOwnedOrThrow(id, userId), today);
  }

  /**
   * Cancels the reservation if the refund is still `expectedRefundPercent`
   * (the one the user confirmed; 409 otherwise). One conditional update
   * moves it from `confirmed` to `cancelled`, so a second cancellation, or
   * the completion job, at the same moment never cancels it twice. Then the
   * nights of every room are released and the refund is created. A failure
   * after the cancellation is saved is logged, never thrown: the reservation
   * stays cancelled. A refund that was recorded but not accepted by Stripe
   * yet stays `pending` and is resent by the PAY-03 recovery job; a refund
   * that could not even be recorded is only in the log (as in FLT-26).
   */
  async cancel(
    id: string,
    userId: string,
    expectedRefundPercent: number,
    now: Date = new Date(),
    today: string = todayUtc(),
  ): Promise<HotelBookingCancellationResponseDto> {
    const booking = await this.findOwnedOrThrow(id, userId);
    const quote = this.quote(booking, today);
    if (quote.refundPercent !== expectedRefundPercent) {
      throw new ConflictException(REFUND_CHANGED_MESSAGE);
    }

    const { matchedCount } = await this.bookings
      .updateOne(
        {
          _id: booking._id,
          userId: booking.userId,
          status: HotelBookingStatus.Confirmed,
        },
        {
          $set: {
            status: HotelBookingStatus.Cancelled,
            cancelledAt: now,
            cancelledBy: CancelledBy.User,
            refundPercent: quote.refundPercent,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      // Cancelled or completed in between.
      throw new ConflictException(NOT_CANCELLABLE_MESSAGE);
    }

    const expectedNights = booking.rooms.length * booking.nights;
    try {
      const freed = await this.roomHolds.unbook(booking._id);
      if (freed !== expectedNights) {
        this.logger.error(
          `Reservation ${quote.bookingId} is cancelled, but ${freed} of its ${expectedNights} booked nights were released`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Reservation ${quote.bookingId} is cancelled, but its ${expectedNights} booked nights were not released`,
        error instanceof Error ? error.stack : error,
      );
    }

    let refund: HotelBookingCancellationResponseDto['refund'] = null;
    try {
      const created = await this.refunds.refund({
        bookingType: BookingType.Hotel,
        bookingId: quote.bookingId,
        refundPercent: quote.refundPercent,
        reason: RefundReason.UserCancellation,
      });
      refund = created && {
        id: created.id,
        status: created.status,
        amount: created.amount,
        currency: created.currency,
        refundPercent: created.refundPercent,
      };
    } catch (error) {
      this.logger.error(
        `Reservation ${quote.bookingId} is cancelled, but its refund could not be created`,
        error instanceof Error ? error.stack : error,
      );
    }

    return {
      ...quote,
      status: HotelBookingStatus.Cancelled,
      cancelledAt: now.toISOString(),
      refund,
    };
  }

  /** The owner's reservation as stored; 404 for a missing one or another user's. */
  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<HotelBookingSource> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    return booking;
  }

  /**
   * The refund on `today`: 409 unless the reservation may move to
   * `cancelled` (GEN-11: only a confirmed one) and its check-in date is
   * still ahead. The tiers are those copied into the reservation, compared
   * with the whole days left until check-in (HTL-10, refundPercentFor), on
   * the full total.
   */
  private quote(
    booking: HotelBookingSource,
    today: string,
  ): HotelBookingCancellationPreviewDto {
    if (!canHotelBookingMoveTo(booking.status, HotelBookingStatus.Cancelled)) {
      throw new ConflictException(NOT_CANCELLABLE_MESSAGE);
    }
    const daysRemaining = daysUntil(today, booking.checkIn);
    if (daysRemaining <= 0) {
      throw new ConflictException(CHECK_IN_REACHED_MESSAGE);
    }
    const refundPercent = refundPercentFor(
      booking.cancellationTiers,
      daysRemaining,
    );
    return {
      bookingId: booking._id.toString(),
      checkIn: booking.checkIn,
      daysRemaining,
      refundPercent,
      total: booking.total,
      refundAmount: Math.round((booking.total * refundPercent) / 100),
      currency: booking.currency,
    };
  }
}
