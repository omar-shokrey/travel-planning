import { RefundStatus } from './enums/refund-status.enum';
import { refundStatusOf } from './refund-status';

describe('refundStatusOf (PAY-03)', () => {
  it.each([
    ['succeeded', RefundStatus.Refunded],
    ['failed', RefundStatus.Failed],
    ['canceled', RefundStatus.Failed],
    ['pending', RefundStatus.Pending],
    ['requires_action', RefundStatus.Pending],
    ['a_status_stripe_adds_later', RefundStatus.Pending],
    [null, RefundStatus.Pending],
    [undefined, RefundStatus.Pending],
  ])('maps Stripe %p to %p', (stripeStatus, expected) => {
    expect(refundStatusOf(stripeStatus)).toBe(expected);
  });
});
