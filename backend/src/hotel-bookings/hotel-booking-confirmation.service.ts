import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelsService } from '../hotels/hotels.service';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { reservationConfirmedMessage } from './booking-confirmation-message';
import { newHotelReference } from './booking-reference';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import {
  CONFIRM_NIGHTS_GRACE_MINUTES,
  REFERENCE_ATTEMPTS,
} from './hotel-bookings.constants';
import type { HotelBookingSource } from './mappers/hotel-booking.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

const MONGO_DUPLICATE_KEY = 11000;

/** The only unique index of a reservation besides `_id` is `reference`. */
const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/**
 * HTL-17: what happens to a hotel reservation once its payment succeeded. The
 * payments webhook calls it through `HotelBookingsService.confirmPaid`, the
 * `BookingPaymentHandler` of PAY-01.
 *
 * 1. **Keep the nights** (`HotelRoomHoldsService.secureHold`): the
 *    reservation's live held nights get a later hold end, so they cannot
 *    expire and be taken by another reservation while this one is confirmed.
 *    Only when every night (rooms x nights) was kept does it go on;
 *    otherwise the payment is late and the nights are released.
 * 2. **Confirm** with one conditional update that matches only a reservation
 *    still `pending_payment` whose hold is live at `now`, and gives it its
 *    reference. The hold-expiry job (HTL-18) matches `holdExpiresAt <= now`,
 *    so the two can never both win, and it never releases a confirmed
 *    reservation's nights.
 * 3. **Book the nights**: every held night of every room becomes booked, all
 *    together (`HotelRoomHoldsService.confirm`).
 * 4. **Notify** the owner (GEN-01).
 *
 * The reservation is confirmed before its nights are booked because the
 * confirmation is the user's proof of payment; step 1 makes that order safe.
 * Steps 3 and 4 never undo it. A database error in step 3 is thrown, so
 * Stripe retries and the retry books the nights; a notification failure is
 * logged.
 */
@Injectable()
export class HotelBookingConfirmationService {
  private readonly logger = new Logger(HotelBookingConfirmationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
    private readonly hotels: HotelsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Returns `true` when the reservation is confirmed, now or before (the same
   * event can arrive twice: the second call sends no second notification).
   * Returns `false`, without throwing, for an unknown reservation and for one
   * whose hold had ended or that is no longer waiting for payment: that
   * payment is late (refund, PAY-03). A database error throws, so the webhook
   * answers 500 and Stripe sends the event again.
   */
  async confirmPaid(bookingId: string, now: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(bookingId)) {
      this.logger.warn(
        `A payment names an invalid reservation id ${bookingId}`,
      );
      return false;
    }
    const id = new Types.ObjectId(bookingId);
    const booking = await this.bookings
      .findById(id)
      .select('reference rooms nights')
      .lean()
      .exec();
    if (!booking) {
      this.logger.warn(
        `A payment names an unknown hotel reservation ${id.toString()}`,
      );
      return false;
    }
    if (booking.reference) {
      return this.afterNoMatch(id);
    }

    // Confirm only when every night is still this reservation's: the webhook's
    // `now` was taken a moment ago, and another reservation's hold may have
    // removed nights whose hold has just ended. Holds are all or nothing, so
    // a payable reservation always keeps rooms x nights of them.
    const secured = await this.roomHolds.secureHold(
      id,
      new Date(now.getTime() + CONFIRM_NIGHTS_GRACE_MINUTES * 60_000),
      now,
    );
    if (secured !== booking.rooms.length * booking.nights) {
      return this.afterNoMatch(id);
    }
    const confirmed = await this.confirmWithReference(id, now);
    if (!confirmed) {
      return this.afterNoMatch(id);
    }
    await this.bookNights(confirmed);
    await this.notifyOwner(confirmed);
    return true;
  }

  /**
   * The confirming update. A new reference that another reservation already
   * has fails on the unique index; the update is then tried again with a new
   * one, at most REFERENCE_ATTEMPTS times.
   */
  private async confirmWithReference(
    id: Types.ObjectId,
    now: Date,
  ): Promise<HotelBookingSource | null> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.bookings
          .findOneAndUpdate(
            {
              _id: id,
              status: HotelBookingStatus.PendingPayment,
              holdExpiresAt: { $gt: now },
            },
            {
              $set: {
                status: HotelBookingStatus.Confirmed,
                reference: newHotelReference(),
              },
            },
            { returnDocument: 'after' },
          )
          .lean()
          .exec();
      } catch (error) {
        if (!isDuplicateKey(error) || attempt >= REFERENCE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * The reservation was confirmed before (a repeated event, or a delivery at
   * the same moment that won), or it cannot be confirmed: its hold ended, its
   * nights are not all its own any more, or it is not pending. Only a
   * confirmed reservation has a reference, and it keeps it when it is
   * completed or cancelled later. A repeated event books any night still
   * held, in case the first delivery stopped between the confirmation and the
   * nights; a late payment releases this reservation's held nights, which
   * step 1 may have kept.
   */
  private async afterNoMatch(id: Types.ObjectId): Promise<boolean> {
    const booking = await this.bookings
      .findById(id)
      .select('reference status')
      .lean()
      .exec();
    if (!booking) {
      this.logger.warn(
        `A payment names an unknown hotel reservation ${id.toString()}`,
      );
      return false;
    }
    if (booking.reference) {
      await this.roomHolds.confirm(id);
      return true;
    }
    await this.roomHolds.release(id);
    return false;
  }

  /**
   * All the nights of all the rooms, together: rooms x nights of them. A
   * database error is thrown, not swallowed: the reservation stays confirmed,
   * the webhook answers 500, and Stripe's retry books the nights through
   * `afterNoMatch` while they are still held (30 minutes). A count that
   * differs is logged.
   */
  private async bookNights(booking: HotelBookingSource): Promise<void> {
    const id = booking._id.toString();
    const expected = booking.rooms.length * booking.nights;
    const booked = await this.roomHolds.confirm(booking._id);
    if (booked !== expected) {
      this.logger.error(
        `Hotel reservation ${id} is confirmed but ${booked} of its ${expected} nights (${booking.rooms.length} room(s) x ${booking.nights} night(s)) became booked. Its remaining nights stay held for ${CONFIRM_NIGHTS_GRACE_MINUTES} minutes; check room_nights for this reservation.`,
      );
    }
  }

  /**
   * The in-app notification, after the confirmation is saved. Reading the
   * hotel or sending can fail; that is logged with the reservation id only
   * and never turns the confirmation into an error.
   */
  private async notifyOwner(booking: HotelBookingSource): Promise<void> {
    try {
      const hotel = await this.hotels.findEntityOrThrow(
        booking.hotelId.toString(),
      );
      await this.notifications.notify(
        booking.userId,
        NotificationType.BookingConfirmed,
        reservationConfirmedMessage({
          reference: booking.reference ?? '',
          hotelName: hotel.name,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          nights: booking.nights,
          rooms: booking.rooms,
        }),
        { type: NotificationLinkType.HotelBooking, id: booking._id },
      );
    } catch (error) {
      this.logger.error(
        `Hotel reservation ${booking._id.toString()} is confirmed, but its notification was not sent`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
