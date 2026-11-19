import { BookingType } from '../enums/booking-type.enum';
import { RefundReason } from './enums/refund-reason.enum';
import { RefundStatus } from './enums/refund-status.enum';

/** "12550, USD" -> "125.50 USD": whole minor units shown in major units, no floating point. */
export function formatMoney(amount: number, currency: string): string {
  const major = Math.floor(amount / 100);
  const minor = String(amount % 100).padStart(2, '0');
  return `${major}.${minor} ${currency.toUpperCase()}`;
}

const BOOKING_LABEL: Record<BookingType, string> = {
  [BookingType.Flight]: 'flight booking',
  [BookingType.Hotel]: 'hotel booking',
};

/**
 * PAY-03: the in-app notification of a refund, by its status. A late payment
 * (`late_payment`) first gets its own text, because the user never cancelled.
 */
export function refundMessage(
  refund: {
    bookingType: BookingType;
    amount: number;
    currency: string;
    reason: RefundReason;
    status: RefundStatus;
  },
  first: boolean,
): string {
  const money = formatMoney(refund.amount, refund.currency);
  if (first && refund.reason === RefundReason.LatePayment) {
    return `Your payment arrived after your booking hold ended, so it is being refunded in full (${money}).`;
  }
  const booking = BOOKING_LABEL[refund.bookingType];
  switch (refund.status) {
    case RefundStatus.Refunded:
      return `Your refund of ${money} for your ${booking} has been sent to your card.`;
    case RefundStatus.Failed:
      return `Your refund of ${money} for your ${booking} failed. Our team will contact you.`;
    default:
      return `Your refund of ${money} for your ${booking} is pending.`;
  }
}
