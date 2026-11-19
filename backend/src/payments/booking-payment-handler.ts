import { BookingType } from './enums/booking-type.enum';

/**
 * What the payment webhook asks of a booking module once the money has
 * arrived. FLT-23 gives it to `FlightBookingsService` and HTL-17 to
 * `HotelBookingsService`; the payments module only calls it.
 */
export interface BookingPaymentHandler {
  /**
   * Confirms the booking after a successful payment. It must be idempotent and
   * must confirm only with an update that matches `status: pending_payment`
   * and `holdExpiresAt > now`. Returns `true` when the booking is confirmed
   * (now or before), and `false` when the hold had already ended: the payment
   * is then late and must be refunded (PAY-03), never confirmed.
   */
  confirmPaid(bookingId: string, now: Date): Promise<boolean>;
}

export type BookingPaymentHandlers = Partial<
  Record<BookingType, BookingPaymentHandler>
>;

/** The injection token of the handlers, by booking type. */
export const BOOKING_PAYMENT_HANDLERS = Symbol('BOOKING_PAYMENT_HANDLERS');

/** The handler a booking service offers, or `undefined` until its issue adds `confirmPaid`. */
export function paymentHandlerOf(
  service: object,
): BookingPaymentHandler | undefined {
  const candidate = service as Partial<BookingPaymentHandler>;
  return typeof candidate.confirmPaid === 'function'
    ? (service as BookingPaymentHandler)
    : undefined;
}
