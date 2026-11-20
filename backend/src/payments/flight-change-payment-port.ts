import type { BookingPaymentHandler } from './booking-payment-handler';
import type { BookingType } from './enums/booking-type.enum';

/** What may be charged for a flight change (FLT-27): the fare difference. */
export interface FlightChangePayable {
  /** Whole minor units of `currency`, at least 1. */
  amount: number;
  currency: string;
  /** UTC end of the hold of the new flight's seats. */
  holdExpiresAt: Date;
}

/** The flight booking a change belongs to: where its notifications link. */
export interface FlightChangeLink {
  bookingType: BookingType.Flight;
  bookingId: string;
}

/**
 * FLT-27: how the payments module reaches a flight change without importing
 * the flight-bookings module's code. The flight-bookings module provides it
 * under `FLIGHT_CHANGE_PAYMENT_PORT` and exports it; until it does, a payment
 * for `flight_change` answers 404 "Booking not found" and nothing else changes.
 *
 * It is also the payment handler of `BookingType.FlightChange`
 * (`BOOKING_PAYMENT_HANDLERS`), so the webhook confirms a change the same way
 * it confirms a booking.
 */
export interface FlightChangePaymentPort extends BookingPaymentHandler {
  /**
   * The amount, currency and end of hold of the user's own change, only while
   * it waits for payment, its hold is live at `now` and its policies were
   * accepted. Otherwise it throws the same 404 or 409 the booking path throws
   * for a flight booking.
   */
  findPayable(
    changeId: string,
    userId: string,
    now: Date,
  ): Promise<FlightChangePayable>;

  /**
   * Applies the paid change. Idempotent. `false` when the hold had ended or
   * the booking can no longer be changed: the payment is then refunded in
   * full (PAY-03), never applied.
   */
  confirmPaid(changeId: string, now: Date): Promise<boolean>;

  /** The flight booking of a change, or `null` for an unknown change. */
  linkOf(changeId: string): Promise<FlightChangeLink | null>;
}

/** The injection token of the port. It is optional everywhere it is injected. */
export const FLIGHT_CHANGE_PAYMENT_PORT = Symbol('FLIGHT_CHANGE_PAYMENT_PORT');
