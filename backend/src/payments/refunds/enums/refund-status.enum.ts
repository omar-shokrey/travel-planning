/**
 * PAY-03: the status of a refund shown on the booking details. `pending`
 * until Stripe confirms; `refunded` and `failed` are final.
 */
export enum RefundStatus {
  Pending = 'pending',
  Refunded = 'refunded',
  Failed = 'failed',
}
