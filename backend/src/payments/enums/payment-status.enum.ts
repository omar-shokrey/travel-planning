/** The status of a payment (PAY-01), as in the `PAYMENT` entity of the data model. */
export enum PaymentStatus {
  /** The PaymentIntent exists and waits for the card to be confirmed. */
  RequiresPayment = 'requires_payment',
  /** Stripe told the webhook that the money was received. Final. */
  Succeeded = 'succeeded',
  /** The last attempt failed; the user may retry until the hold ends. */
  Failed = 'failed',
  /** The PaymentIntent was cancelled, because the hold ended. Final. */
  Cancelled = 'cancelled',
}
