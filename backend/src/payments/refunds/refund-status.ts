import { RefundStatus } from './enums/refund-status.enum';

/**
 * PAY-03: Stripe's refund status as ours. `succeeded` is refunded; `failed`
 * and `canceled` are failed (the money stays in our Stripe balance); anything
 * else (`pending`, `requires_action`, a status Stripe adds later, or none) is
 * still pending, so an unknown status never claims the money arrived.
 */
export function refundStatusOf(
  stripeStatus: string | null | undefined,
): RefundStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return RefundStatus.Refunded;
    case 'failed':
    case 'canceled':
      return RefundStatus.Failed;
    default:
      return RefundStatus.Pending;
  }
}
