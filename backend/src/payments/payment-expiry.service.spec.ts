import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { PaymentStatus } from './enums/payment-status.enum';
import type { Payment } from './models/payment.schema';
import { PaymentExpiryService } from './payment-expiry.service';
import { PAYMENT_EXPIRY_BATCH_SIZE } from './payments.constants';
import type { StripeGateway } from './stripe.gateway';

const NOW = new Date('2026-11-20T10:11:00.000Z');
const OPEN = [PaymentStatus.RequiresPayment, PaymentStatus.Failed];

const due = (...intentIds: string[]) =>
  intentIds.map((stripePaymentIntentId) => ({
    _id: new Types.ObjectId(),
    stripePaymentIntentId,
  }));

function setup(options: { due?: unknown[]; matched?: number } = {}) {
  const find: Record<'sort' | 'limit' | 'select' | 'lean' | 'exec', jest.Mock> =
    {
      sort: jest.fn(() => find),
      limit: jest.fn(() => find),
      select: jest.fn(() => find),
      lean: jest.fn(() => find),
      exec: jest.fn(() => Promise.resolve(options.due ?? [])),
    };
  const payments = {
    find: jest.fn(() => find),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ matchedCount: options.matched ?? 1 }),
    })),
  };
  const gateway = {
    cancelPaymentIntent: jest.fn(() => Promise.resolve({})),
    // After a refusal the job reads the intent back. By default it succeeded.
    retrievePaymentIntent: jest.fn((): Promise<{ status: string }> =>
      Promise.resolve({ status: 'succeeded' }),
    ),
  };
  const service = new PaymentExpiryService(
    payments as unknown as Model<Payment>,
    gateway as unknown as StripeGateway,
  );
  return { service, payments, find, gateway };
}

describe('PaymentExpiryService (PAY-01)', () => {
  it('looks for the open payments whose hold ended, oldest first, in a batch', async () => {
    const { service, payments, find } = setup();

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(0);

    expect(payments.find).toHaveBeenCalledWith({
      status: { $in: OPEN },
      holdExpiresAt: { $lte: NOW },
    });
    expect(find.sort).toHaveBeenCalledWith({ holdExpiresAt: 1 });
    expect(find.limit).toHaveBeenCalledWith(PAYMENT_EXPIRY_BATCH_SIZE);
  });

  it('cancels the PaymentIntent at Stripe, then marks the payment cancelled if it is still open', async () => {
    const [payment] = due('pi_1');
    const { service, payments, gateway } = setup({ due: [payment] });

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(1);

    expect(gateway.cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { _id: payment._id, status: { $in: OPEN } },
      { $set: { status: PaymentStatus.Cancelled } },
    );
  });

  it('leaves a payment alone when Stripe refuses (it just succeeded) and goes on with the others', async () => {
    const [first, second] = due('pi_1', 'pi_2');
    const { service, payments, gateway } = setup({ due: [first, second] });
    gateway.cancelPaymentIntent.mockRejectedValueOnce(
      new Error('already succeeded'),
    );

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(1);

    expect(payments.updateOne).toHaveBeenCalledTimes(1);
    expect(payments.updateOne).toHaveBeenCalledWith(
      { _id: second._id, status: { $in: OPEN } },
      expect.anything(),
    );
  });

  it('marks the payment cancelled when Stripe refuses because the intent was already cancelled, so it is not tried forever', async () => {
    const [first] = due('pi_1');
    const { service, payments, gateway } = setup({ due: [first] });
    gateway.cancelPaymentIntent.mockRejectedValueOnce(
      new Error('already canceled'),
    );
    gateway.retrievePaymentIntent.mockResolvedValueOnce({
      status: 'canceled',
    });

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(1);

    expect(gateway.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { _id: first._id, status: { $in: OPEN } },
      { $set: { status: PaymentStatus.Cancelled } },
    );
  });

  it('leaves the payment alone when Stripe can neither cancel nor read the intent', async () => {
    const { service, payments, gateway } = setup({ due: due('pi_1') });
    gateway.cancelPaymentIntent.mockRejectedValueOnce(new Error('network'));
    gateway.retrievePaymentIntent.mockRejectedValueOnce(new Error('network'));

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(0);

    expect(payments.updateOne).not.toHaveBeenCalled();
  });

  it('does not count a payment that another run or the webhook already moved', async () => {
    const { service } = setup({ due: due('pi_1'), matched: 0 });

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(0);
  });

  it('logs and goes on when marking the payment fails', async () => {
    const { service, payments } = setup({ due: due('pi_1', 'pi_2') });
    payments.updateOne.mockImplementationOnce(() => ({
      exec: () => Promise.reject(new Error('write failed')),
    }));

    await expect(service.cancelDuePayments(NOW)).resolves.toBe(1);
  });

  it('runs every minute', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PaymentExpiryService.prototype.cancelDuePaymentsJob,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_MINUTE,
      name: 'payment-hold-expiry',
    });
  });

  it('never throws from the scheduled method: the error is logged', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { service, payments } = setup();
    payments.find.mockImplementationOnce(() => {
      throw new Error('database down');
    });

    await expect(service.cancelDuePaymentsJob()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    logError.mockRestore();
  });
});
