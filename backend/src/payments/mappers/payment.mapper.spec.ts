import { Types } from 'mongoose';
import { BookingType } from '../enums/booking-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import { toPaymentIntentResponse, toPaymentResponse } from './payment.mapper';

const source = () => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc'),
  bookingType: BookingType.Hotel,
  bookingId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
  userId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  stripePaymentIntentId: 'pi_1',
  amount: 37500,
  currency: 'USD',
  status: PaymentStatus.Failed,
  holdExpiresAt: new Date('2026-11-20T10:10:00.000Z'),
  createdAt: new Date('2026-11-20T10:00:00.000Z'),
  updatedAt: new Date('2026-11-20T10:03:00.000Z'),
});

describe('toPaymentResponse (PAY-01)', () => {
  it('returns string ids, UTC moments ending in Z, and whole minor units', () => {
    expect(toPaymentResponse(source())).toEqual({
      id: '6740f1c2a4b5c6d7e8f90abc',
      bookingType: 'hotel',
      bookingId: '6740f1c2a4b5c6d7e8f90789',
      stripePaymentIntentId: 'pi_1',
      amount: 37500,
      currency: 'USD',
      status: 'failed',
      holdExpiresAt: '2026-11-20T10:10:00.000Z',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:03:00.000Z',
    });
  });

  it('never returns the owner, a Mongo field or a client secret', () => {
    const response = toPaymentResponse(source());

    expect(Object.keys(response)).not.toEqual(
      expect.arrayContaining(['userId', '_id', '__v', 'clientSecret']),
    );
  });
});

describe('toPaymentIntentResponse (PAY-01)', () => {
  it('adds the client secret to the payment', () => {
    const response = toPaymentIntentResponse(source(), 'pi_1_secret_abc');

    expect(response).toEqual({
      ...toPaymentResponse(source()),
      clientSecret: 'pi_1_secret_abc',
    });
  });
});
