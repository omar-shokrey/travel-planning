import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import { RefundStatus } from './enums/refund-status.enum';
import { RefundRecoveryService } from './refund-recovery.service';
import type { RefundsService } from './refunds.service';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const ONE_MINUTE_AGO = new Date('2026-11-20T11:59:00.000Z');
const TWELVE_HOURS_AGO = new Date('2026-11-20T00:00:00.000Z');

const pending = () => ({
  _id: new Types.ObjectId(),
  status: RefundStatus.Pending,
  createdAt: new Date('2026-11-20T11:00:00.000Z'),
});

function setup(due: unknown[] = [], stuck = 0) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(() => Promise.resolve(due)),
  };
  const refunds = {
    find: jest.fn(() => chain),
    countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(stuck) })),
  };
  const refundsService = {
    resubmit: jest.fn((refund: { _id: Types.ObjectId }) =>
      Promise.resolve({ ...refund, stripeRefundId: 're_new' }),
    ),
  };
  const service = new RefundRecoveryService(
    refunds as never,
    refundsService as unknown as RefundsService,
  );
  return { service, refunds, chain, refundsService };
}

let logError: jest.SpyInstance;

beforeEach(() => {
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RefundRecoveryService.recover (PAY-03)', () => {
  it('picks pending refunds without a Stripe id, older than a minute and younger than 12 hours, oldest first, 50 at most', async () => {
    const { service, refunds, chain } = setup();

    await service.recover(NOW);

    expect(refunds.find).toHaveBeenCalledWith({
      status: RefundStatus.Pending,
      stripeRefundId: { $exists: false },
      createdAt: { $lte: ONE_MINUTE_AGO, $gt: TWELVE_HOURS_AGO },
    });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it('resends each refund and counts the ones Stripe took', async () => {
    const due = [pending(), pending()];
    const { service, refundsService } = setup(due);

    await expect(service.recover(NOW)).resolves.toBe(2);
    expect(refundsService.resubmit).toHaveBeenCalledTimes(2);
    expect(refundsService.resubmit).toHaveBeenNthCalledWith(1, due[0]);
  });

  it('does not count a refund Stripe still could not take', async () => {
    const { service, refundsService } = setup([pending()]);
    refundsService.resubmit.mockImplementationOnce((refund) =>
      Promise.resolve({ ...refund, stripeRefundId: undefined as never }),
    );

    await expect(service.recover(NOW)).resolves.toBe(0);
  });

  it('logs a failing refund and still resends the next one', async () => {
    const due = [pending(), pending()];
    const { service, refundsService } = setup(due);
    refundsService.resubmit.mockRejectedValueOnce(new Error('database down'));

    await expect(service.recover(NOW)).resolves.toBe(1);
    expect(refundsService.resubmit).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(due[0]._id.toString()),
      expect.anything(),
    );
  });

  it('reports refunds stuck for more than 12 hours as an error, without resending them', async () => {
    const { service, refunds, refundsService } = setup([], 3);

    await service.recover(NOW);

    expect(refunds.countDocuments).toHaveBeenCalledWith({
      status: RefundStatus.Pending,
      stripeRefundId: { $exists: false },
      createdAt: { $lte: TWELVE_HOURS_AGO },
    });
    expect(refundsService.resubmit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('3 refund(s) are pending for more than 12 hours'),
    );
  });
});

describe('RefundRecoveryService.recoverJob (PAY-03)', () => {
  it('runs every 5 minutes', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        RefundRecoveryService.prototype.recoverJob,
      ),
    ).toMatchObject({ cronTime: CronExpression.EVERY_5_MINUTES });
  });

  it('catches and logs every error, so the job never crashes the app', async () => {
    const { service, chain } = setup();
    chain.exec.mockImplementationOnce(() =>
      Promise.reject(new Error('database down')),
    );

    await expect(service.recoverJob()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
