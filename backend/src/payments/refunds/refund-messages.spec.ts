import { BookingType } from '../enums/booking-type.enum';
import { RefundReason } from './enums/refund-reason.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { formatMoney, refundMessage } from './refund-messages';

const refund = (fields: Partial<Parameters<typeof refundMessage>[0]> = {}) => ({
  bookingType: BookingType.Flight,
  amount: 12550,
  currency: 'USD',
  reason: RefundReason.UserCancellation,
  status: RefundStatus.Pending,
  ...fields,
});

describe('formatMoney (PAY-03)', () => {
  it.each([
    [12550, '125.50 USD'],
    [12505, '125.05 USD'],
    [100, '1.00 USD'],
    [7, '0.07 USD'],
  ])('shows %p minor units as %p', (amount, text) => {
    expect(formatMoney(amount, 'usd')).toBe(text);
  });
});

describe('refundMessage (PAY-03)', () => {
  it('says a refund is pending', () => {
    expect(refundMessage(refund(), true)).toBe(
      'Your refund of 125.50 USD for your flight booking is pending.',
    );
  });

  it('says a refund was sent, for a hotel booking', () => {
    expect(
      refundMessage(
        refund({
          bookingType: BookingType.Hotel,
          status: RefundStatus.Refunded,
        }),
        false,
      ),
    ).toBe(
      'Your refund of 125.50 USD for your hotel booking has been sent to your card.',
    );
  });

  it('says a refund failed', () => {
    expect(refundMessage(refund({ status: RefundStatus.Failed }), false)).toBe(
      'Your refund of 125.50 USD for your flight booking failed. Our team will contact you.',
    );
  });

  it('explains a late payment the first time, then follows the status', () => {
    const late = refund({ reason: RefundReason.LatePayment });

    expect(refundMessage(late, true)).toBe(
      'Your payment arrived after your booking hold ended, so it is being refunded in full (125.50 USD).',
    );
    expect(
      refundMessage({ ...late, status: RefundStatus.Refunded }, false),
    ).toBe(
      'Your refund of 125.50 USD for your flight booking has been sent to your card.',
    );
  });

  it('explains a cheaper flight (fare_difference, FLT-27) the first time, then follows the status of the flight booking', () => {
    const fare = refund({
      bookingType: BookingType.FlightChange,
      amount: 4000,
      reason: RefundReason.FareDifference,
    });

    expect(refundMessage(fare, true)).toBe(
      'Your new flight costs less: the fare difference of 40.00 USD is being refunded to your card.',
    );
    expect(refundMessage({ ...fare, status: RefundStatus.Failed }, false)).toBe(
      'Your refund of 40.00 USD for your flight booking failed. Our team will contact you.',
    );
  });

  it('names a flight_change refund as a flight booking (a late change payment)', () => {
    expect(
      refundMessage(
        refund({
          bookingType: BookingType.FlightChange,
          status: RefundStatus.Refunded,
        }),
        true,
      ),
    ).toBe(
      'Your refund of 125.50 USD for your flight booking has been sent to your card.',
    );
  });
});
