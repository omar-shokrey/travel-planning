import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingType } from '../payments/enums/booking-type.enum';
import type {
  FlightChangeLink,
  FlightChangePayable,
  FlightChangePaymentPort,
} from '../payments/flight-change-payment-port';
import {
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from '../payments/payments.constants';
import { FlightChangeStatus } from './enums/flight-change-status.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightChangeService } from './flight-change.service';

/**
 * FLT-27: the flight change port of the payments module
 * (`FLIGHT_CHANGE_PAYMENT_PORT`), provided and exported by this module. The
 * payments module charges a change and confirms it only through these three
 * methods, and never imports this module's code for it.
 */
@Injectable()
export class FlightChangePaymentService implements FlightChangePaymentPort {
  constructor(private readonly changes: FlightChangeService) {}

  /**
   * The fare difference of the user's own change, only while it waits for
   * payment, its hold is live at `now` and its policies were accepted. The
   * same answers as a booking (PAY-02): 404 "Booking not found" for a missing
   * change or someone else's, 409 otherwise. The amount never changes for a
   * change: it was fixed when the change was made.
   */
  async findPayable(
    changeId: string,
    userId: string,
    now: Date,
  ): Promise<FlightChangePayable> {
    const change = await this.changes.findOwned(changeId, userId);
    if (!change) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    if (change.status !== FlightChangeStatus.PendingPayment) {
      throw new ConflictException(NOT_WAITING_FOR_PAYMENT_MESSAGE);
    }
    if (
      !change.holdExpiresAt ||
      change.holdExpiresAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException(HOLD_EXPIRED_MESSAGE);
    }
    if (!change.policyAcceptedAt) {
      throw new ConflictException(POLICIES_NOT_ACCEPTED_MESSAGE);
    }
    return {
      amount: change.difference,
      currency: change.currency,
      holdExpiresAt: change.holdExpiresAt,
    };
  }

  /** The webhook: apply the paid change (see `FlightChangeService.confirmPaid`). */
  confirmPaid(changeId: string, now: Date): Promise<boolean> {
    return this.changes.confirmPaid(changeId, now);
  }

  /** The flight booking of a change, for the refund notifications' links. */
  async linkOf(changeId: string): Promise<FlightChangeLink | null> {
    const bookingId = await this.changes.bookingOf(changeId);
    return bookingId
      ? { bookingType: BookingType.Flight, bookingId: bookingId.toString() }
      : null;
  }
}
