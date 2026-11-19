import type { Types } from 'mongoose';
import type {
  RefundResponseDto,
  RefundSummaryDto,
} from '../dto/refund-response.dto';
import type { Refund } from '../models/refund.schema';

export type RefundSource = Refund & { _id: Types.ObjectId };

/** PAY-03: a refund as its owner sees it. Ids as strings, moments in UTC; never the owner. */
export function toRefundResponse(refund: RefundSource): RefundResponseDto {
  return {
    id: refund._id.toString(),
    bookingType: refund.bookingType,
    bookingId: refund.bookingId.toString(),
    paymentId: refund.paymentId.toString(),
    amount: refund.amount,
    currency: refund.currency,
    refundPercent: refund.refundPercent,
    reason: refund.reason,
    status: refund.status,
    stripeRefundId: refund.stripeRefundId ?? null,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

/** PAY-03: the small piece the booking details embed. */
export function toRefundSummary(refund: RefundSource): RefundSummaryDto {
  return {
    id: refund._id.toString(),
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    refundPercent: refund.refundPercent,
  };
}
