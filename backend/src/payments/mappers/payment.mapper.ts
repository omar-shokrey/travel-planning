import type { Types } from 'mongoose';
import type {
  PaymentIntentResponseDto,
  PaymentResponseDto,
} from '../dto/payment-response.dto';
import type { Payment } from '../models/payment.schema';

/** What the mapper reads: a document and a lean payment both fit. */
export type PaymentSource = Pick<
  Payment,
  | 'bookingType'
  | 'stripePaymentIntentId'
  | 'amount'
  | 'currency'
  | 'status'
  | 'holdExpiresAt'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId; bookingId: Types.ObjectId };

/** PAY-01: a payment's public fields. The owner id never leaves the API. */
export function toPaymentResponse(payment: PaymentSource): PaymentResponseDto {
  return {
    id: payment._id.toString(),
    bookingType: payment.bookingType,
    bookingId: payment.bookingId.toString(),
    stripePaymentIntentId: payment.stripePaymentIntentId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    holdExpiresAt: payment.holdExpiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

/** A payment with the client secret the owner needs to confirm it. */
export function toPaymentIntentResponse(
  payment: PaymentSource,
  clientSecret: string,
): PaymentIntentResponseDto {
  return { ...toPaymentResponse(payment), clientSecret };
}
