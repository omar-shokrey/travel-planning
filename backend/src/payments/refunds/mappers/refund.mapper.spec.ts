import { Types } from 'mongoose';
import { BookingType } from '../../enums/booking-type.enum';
import { RefundReason } from '../enums/refund-reason.enum';
import { RefundStatus } from '../enums/refund-status.enum';
import {
  type RefundSource,
  toRefundResponse,
  toRefundSummary,
} from './refund.mapper';

const refund = (fields: Partial<RefundSource> = {}): RefundSource => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa'),
  bookingType: BookingType.Flight,
  bookingId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
  paymentId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb'),
  userId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  amount: 12550,
  currency: 'USD',
  refundPercent: 50,
  reason: RefundReason.UserCancellation,
  status: RefundStatus.Refunded,
  stripeRefundId: 're_1',
  createdAt: new Date('2026-11-20T10:00:00.000Z'),
  updatedAt: new Date('2026-11-20T10:00:05.000Z'),
  ...fields,
});

describe('toRefundResponse (PAY-03)', () => {
  it('returns the public fields, ids as strings and moments as UTC Z strings', () => {
    expect(toRefundResponse(refund())).toEqual({
      id: '6740f1c2a4b5c6d7e8f90aaa',
      bookingType: 'flight',
      bookingId: '6740f1c2a4b5c6d7e8f90789',
      paymentId: '6740f1c2a4b5c6d7e8f90bbb',
      amount: 12550,
      currency: 'USD',
      refundPercent: 50,
      reason: 'user_cancellation',
      status: 'refunded',
      stripeRefundId: 're_1',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:05.000Z',
    });
  });

  it('shows stripeRefundId null until Stripe took the refund', () => {
    expect(
      toRefundResponse(
        refund({ stripeRefundId: undefined, status: RefundStatus.Pending }),
      ).stripeRefundId,
    ).toBeNull();
  });

  it('never returns the owner or Mongo internals', () => {
    const response = toRefundResponse(refund());

    for (const key of ['userId', '_id', '__v']) {
      expect(response).not.toHaveProperty(key);
    }
  });
});

describe('toRefundSummary (PAY-03)', () => {
  it('returns only what the booking details show', () => {
    expect(toRefundSummary(refund())).toEqual({
      id: '6740f1c2a4b5c6d7e8f90aaa',
      status: 'refunded',
      amount: 12550,
      currency: 'USD',
      refundPercent: 50,
    });
  });
});
