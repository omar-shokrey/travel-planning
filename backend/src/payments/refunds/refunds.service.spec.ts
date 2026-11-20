import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { Types } from 'mongoose';
import { NotificationLinkType } from '../../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../../notifications/notifications.service';
import { BookingType } from '../enums/booking-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import type { StripeGateway } from '../stripe.gateway';
import { RefundReason } from './enums/refund-reason.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { FLIGHT_CHANGE_PAYMENT_PORT } from '../flight-change-payment-port';
import { REFUND_EXCEEDS_PAYMENT_MESSAGE } from './refunds.constants';
import { percentOf, RefundsService } from './refunds.service';

const BOOKING_ID = '6740f1c2a4b5c6d7e8f90789';
const PAYMENT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb');
const USER_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const REFUND_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const NOW = new Date('2026-11-20T10:00:00.000Z');

const payment = (fields: Record<string, unknown> = {}) => ({
  _id: PAYMENT_ID,
  bookingType: BookingType.Flight,
  bookingId: new Types.ObjectId(BOOKING_ID),
  userId: USER_ID,
  stripePaymentIntentId: 'pi_1',
  amount: 25100,
  currency: 'USD',
  status: PaymentStatus.Succeeded,
  ...fields,
});

const request = (fields: Record<string, unknown> = {}) => ({
  bookingType: BookingType.Flight,
  bookingId: BOOKING_ID,
  refundPercent: 100,
  reason: RefundReason.UserCancellation,
  ...fields,
});

const duplicateKey = () =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

/** A chain `.lean().orFail().exec()` / `.select()...` that resolves to `value`. */
interface FakeQuery {
  select: jest.Mock<FakeQuery, []>;
  lean: jest.Mock<FakeQuery, []>;
  orFail: jest.Mock<FakeQuery, []>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const query = (value: unknown): FakeQuery => {
  const chain: FakeQuery = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    orFail: jest.fn(() => chain),
    exec: jest.fn(() => Promise.resolve(value)),
  };
  return chain;
};

function setup(storedPayment: unknown = payment()) {
  /** The refunds the fake collection holds, by booking. */
  const stored = new Map<string, Record<string, unknown>>();
  const refunds = {
    create: jest.fn((doc: Record<string, unknown>) => {
      const key = `${String(doc.bookingType)}-${String(doc.bookingId)}`;
      if (stored.has(key)) {
        return Promise.reject(duplicateKey());
      }
      const saved = { _id: REFUND_ID, ...doc, createdAt: NOW, updatedAt: NOW };
      stored.set(key, saved);
      return Promise.resolve({ toObject: () => ({ ...saved }) });
    }),
    findOne: jest.fn((filter: Record<string, unknown>) =>
      query(
        stored.get(
          `${String(filter.bookingType)}-${String(filter.bookingId)}`,
        ) ?? null,
      ),
    ),
    findOneAndUpdate: jest.fn(
      (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        const saved = [...stored.values()][0];
        Object.assign(saved, update.$set);
        return query({ ...saved });
      },
    ),
    findById: jest.fn(() => query([...stored.values()][0] ?? null)),
    // The refunds already made against a payment (FLT-27 remaining amount).
    find: jest.fn((filter: { paymentId?: unknown }) =>
      query(
        [...stored.values()].filter(
          (refund) =>
            String(refund.paymentId) === String(filter.paymentId) &&
            refund.status !== RefundStatus.Failed,
        ),
      ),
    ),
    deleteOne: jest.fn((filter: { _id: unknown }) => {
      for (const [key, refund] of stored) {
        if (String(refund._id) === String(filter._id)) {
          stored.delete(key);
        }
      }
      return query({ deletedCount: 1 });
    }),
  };
  const payments = {
    findOne: jest.fn(() => query(storedPayment)),
    findById: jest.fn(() => query(storedPayment)),
  };
  const gateway = {
    createRefund: jest.fn(() =>
      Promise.resolve({
        id: 're_1',
        status: 'pending',
        amount: 25100,
        currency: 'usd',
        paymentIntentId: 'pi_1',
      }),
    ),
  };
  const notifications = { notify: jest.fn(() => Promise.resolve()) };
  const service = new RefundsService(
    refunds as never,
    payments as never,
    gateway as unknown as StripeGateway,
    notifications as unknown as NotificationsService,
  );
  return { service, refunds, payments, gateway, notifications, stored };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RefundsService.refund (PAY-03)', () => {
  it('records 100% of the payment as pending, sends it to Stripe and stores its id', async () => {
    const { service, refunds, gateway } = setup();

    const refund = await service.refund(request());

    expect(refunds.create).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(BOOKING_ID),
      paymentId: PAYMENT_ID,
      userId: USER_ID,
      amount: 25100,
      currency: 'USD',
      refundPercent: 100,
      reason: RefundReason.UserCancellation,
      status: RefundStatus.Pending,
    });
    expect(gateway.createRefund).toHaveBeenCalledWith(
      {
        paymentIntentId: 'pi_1',
        amount: 25100,
        metadata: { bookingType: 'flight', bookingId: BOOKING_ID },
      },
      `refund-flight-${BOOKING_ID}`,
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: REFUND_ID, stripeRefundId: { $exists: false } },
      { $set: { stripeRefundId: 're_1', status: RefundStatus.Pending } },
      { returnDocument: 'after' },
    );
    expect(refund).toMatchObject({
      id: REFUND_ID.toString(),
      amount: 25100,
      currency: 'USD',
      refundPercent: 100,
      status: 'pending',
      stripeRefundId: 're_1',
    });
    expect(refund).not.toHaveProperty('userId');
  });

  it.each([
    [50, 25100, 12550],
    // 12345 × 33% = 4073.85: rounded to a whole minor unit.
    [33, 12345, 4074],
    [25, 999, 250],
  ])('refunds %p%% of %p as %p minor units', async (percent, paid, amount) => {
    const { service, refunds } = setup(payment({ amount: paid }));

    await service.refund(request({ refundPercent: percent }));

    expect(refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount, refundPercent: percent }),
    );
  });

  it('stores the mapped status when Stripe answers succeeded', async () => {
    const { service, gateway } = setup();
    gateway.createRefund.mockResolvedValueOnce({
      id: 're_2',
      status: 'succeeded',
      amount: 25100,
      currency: 'usd',
      paymentIntentId: 'pi_1',
    });

    await expect(service.refund(request())).resolves.toMatchObject({
      status: 'refunded',
      stripeRefundId: 're_2',
    });
  });

  it('takes the owner, the payment, the amount and the currency from the payment, never from the caller', async () => {
    const { service, refunds } = setup(
      payment({
        userId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90999'),
        currency: 'USD',
      }),
    );

    await service.refund({
      ...request(),
      // Not part of the contract: ignored if a caller ever sends it.
      ...({ amount: 1, userId: 'x', currency: 'EUR' } as object),
    });

    expect(refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90999'),
        paymentId: PAYMENT_ID,
        amount: 25100,
        currency: 'USD',
      }),
    );
  });

  it('creates nothing for 0%: no read, no insert, no Stripe call, no notification', async () => {
    const { service, payments, refunds, gateway, notifications } = setup();

    await expect(
      service.refund(request({ refundPercent: 0 })),
    ).resolves.toBeNull();
    expect(payments.findOne).not.toHaveBeenCalled();
    expect(refunds.create).not.toHaveBeenCalled();
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('creates nothing when the amount rounds to 0', async () => {
    const { service, refunds, gateway, notifications } = setup(
      payment({ amount: 1 }),
    );

    await expect(
      service.refund(request({ refundPercent: 10 })),
    ).resolves.toBeNull();
    expect(refunds.create).not.toHaveBeenCalled();
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('answers 404 when the booking has no succeeded payment', async () => {
    const { service, payments, refunds } = setup(null);

    await expect(service.refund(request())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(payments.findOne).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(BOOKING_ID),
      status: PaymentStatus.Succeeded,
    });
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it.each([-1, 101, 12.5])(
    'refuses a percent of %p (a programming error)',
    async (refundPercent) => {
      const { service } = setup();

      await expect(
        service.refund(request({ refundPercent })),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  it.each([
    ['502', new BadGatewayException('The payment service is unavailable')],
    ['503', new ServiceUnavailableException('Payments are not configured')],
  ])(
    'leaves the refund pending without a Stripe id when Stripe answers %s, and does not throw',
    async (_code, failure) => {
      const { service, gateway, refunds, notifications } = setup();
      gateway.createRefund.mockRejectedValueOnce(failure);

      const refund = await service.refund(request());

      expect(refund).toMatchObject({ status: 'pending', stripeRefundId: null });
      expect(refunds.findOneAndUpdate).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    },
  );

  it('rethrows an error that is not Stripe trouble', async () => {
    const { service, gateway } = setup();
    gateway.createRefund.mockRejectedValueOnce(new Error('database down'));

    await expect(service.refund(request())).rejects.toThrow('database down');
  });

  it('returns the existing refund for a second call: Stripe and the notification once in total', async () => {
    const { service, gateway, notifications } = setup();

    const first = await service.refund(request());
    const second = await service.refund(
      request({ refundPercent: 50, reason: RefundReason.FlightCancelled }),
    );

    expect(second).toEqual(first);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('returns the existing refund when two calls race and the insert hits the unique index', async () => {
    const { service, refunds, gateway, notifications, stored } = setup();
    // The other call inserted between our read and our insert.
    stored.set(`flight-${BOOKING_ID}`, {
      _id: REFUND_ID,
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(BOOKING_ID),
      paymentId: PAYMENT_ID,
      userId: USER_ID,
      amount: 25100,
      currency: 'USD',
      refundPercent: 100,
      reason: RefundReason.UserCancellation,
      status: RefundStatus.Pending,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const refund = await service.refund(request());

    expect(refunds.create).toHaveBeenCalledTimes(1);
    expect(refund).toMatchObject({
      id: REFUND_ID.toString(),
      status: 'pending',
    });
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('notifies the owner with a link to the booking', async () => {
    const { service, notifications } = setup(payment({ amount: 12550 }));

    await service.refund(request());

    expect(notifications.notify).toHaveBeenCalledWith(
      USER_ID,
      NotificationType.Refund,
      'Your refund of 125.50 USD for your flight booking is pending.',
      { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
    );
  });

  it('explains a late payment refund, linked to a hotel booking', async () => {
    const { service, notifications } = setup(
      payment({ bookingType: BookingType.Hotel, amount: 12550 }),
    );

    await service.refund(
      request({
        bookingType: BookingType.Hotel,
        reason: RefundReason.LatePayment,
      }),
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      USER_ID,
      NotificationType.Refund,
      'Your payment arrived after your booking hold ended, so it is being refunded in full (125.50 USD).',
      { type: NotificationLinkType.HotelBooking, id: BOOKING_ID },
    );
  });
});

describe('RefundsService.findSummaryByBooking (PAY-03)', () => {
  it("returns the booking's refund for the booking details", async () => {
    const { service } = setup();
    await service.refund(request({ refundPercent: 50 }));

    await expect(
      service.findSummaryByBooking(BookingType.Flight, BOOKING_ID),
    ).resolves.toEqual({
      id: REFUND_ID.toString(),
      status: 'pending',
      amount: 12550,
      currency: 'USD',
      refundPercent: 50,
    });
  });

  it('returns null for a booking without a refund', async () => {
    const { service } = setup();

    await expect(
      service.findSummaryByBooking(BookingType.Hotel, BOOKING_ID),
    ).resolves.toBeNull();
  });
});

describe('RefundsService: owner read, webhook status and resend (PAY-03)', () => {
  const storedRefund = (fields: Record<string, unknown> = {}) => ({
    _id: REFUND_ID,
    bookingType: BookingType.Flight,
    bookingId: new Types.ObjectId(BOOKING_ID),
    paymentId: PAYMENT_ID,
    userId: USER_ID,
    amount: 12550,
    currency: 'USD',
    refundPercent: 50,
    reason: RefundReason.UserCancellation,
    status: RefundStatus.Pending,
    stripeRefundId: 're_1',
    createdAt: NOW,
    updatedAt: NOW,
    ...fields,
  });

  /** A fake whose findOne and findOneAndUpdate answer what each test gives. */
  function fakes(found: unknown, moved: unknown = null) {
    const refunds = {
      findOne: jest.fn(() => query(found)),
      findOneAndUpdate: jest.fn(() => query(moved)),
      findById: jest.fn(() => query(moved ?? found)),
    };
    const payments = { findById: jest.fn(() => query(payment())) };
    const gateway = { createRefund: jest.fn() };
    const notifications = { notify: jest.fn(() => Promise.resolve()) };
    const service = new RefundsService(
      refunds as never,
      payments as never,
      gateway as unknown as StripeGateway,
      notifications as unknown as NotificationsService,
    );
    return { service, refunds, payments, gateway, notifications };
  }

  it("returns the owner's refund, looked up by id and owner", async () => {
    const { service, refunds } = fakes(storedRefund());

    await expect(
      service.findOwned(REFUND_ID.toString(), USER_ID.toString()),
    ).resolves.toMatchObject({ id: REFUND_ID.toString(), status: 'pending' });
    expect(refunds.findOne).toHaveBeenCalledWith({
      _id: REFUND_ID.toString(),
      userId: USER_ID,
    });
  });

  it("answers 404 'Refund not found' for someone else's refund or a missing one", async () => {
    const { service } = fakes(null);

    await expect(
      service.findOwned(REFUND_ID.toString(), USER_ID.toString()),
    ).rejects.toThrow(new NotFoundException('Refund not found'));
  });

  it.each([
    ['succeeded', RefundStatus.Refunded],
    ['failed', RefundStatus.Failed],
    ['canceled', RefundStatus.Failed],
  ])(
    'moves a pending refund forward when Stripe reports %s, and notifies once',
    async (stripeStatus, status) => {
      const { service, refunds, notifications } = fakes(
        storedRefund(),
        storedRefund({ status }),
      );

      await service.applyStripeStatus('re_1', stripeStatus);

      expect(refunds.findOne).toHaveBeenCalledWith({ stripeRefundId: 're_1' });
      expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: REFUND_ID, status: RefundStatus.Pending },
        { $set: { status } },
        { returnDocument: 'after' },
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    },
  );

  it('does not move or notify a refund that is already final (a repeated event)', async () => {
    const { service, notifications } = fakes(
      storedRefund({ status: RefundStatus.Refunded }),
      null,
    );

    await service.applyStripeStatus('re_1', 'succeeded');

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('never moves a refund back to pending', async () => {
    const { service, refunds, notifications } = fakes(storedRefund());

    await service.applyStripeStatus('re_1', 'requires_action');

    expect(refunds.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('logs and ignores an unknown Stripe refund id', async () => {
    const { service, refunds, notifications } = fakes(null);

    await expect(
      service.applyStripeStatus('re_unknown', 'succeeded'),
    ).resolves.toBeUndefined();
    expect(refunds.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('resends a refund with the payment intent of its payment and notifies when Stripe settled it', async () => {
    const pending = storedRefund({ stripeRefundId: undefined });
    const { service, gateway, payments, notifications } = fakes(
      pending,
      storedRefund({ status: RefundStatus.Refunded, stripeRefundId: 're_9' }),
    );
    gateway.createRefund.mockResolvedValue({
      id: 're_9',
      status: 'succeeded',
      amount: 12550,
      currency: 'usd',
      paymentIntentId: 'pi_1',
    });

    const sent = await service.resubmit(pending);

    expect(payments.findById).toHaveBeenCalledWith(PAYMENT_ID);
    expect(gateway.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_1', amount: 12550 }),
      `refund-flight-${BOOKING_ID}`,
    );
    expect(sent.stripeRefundId).toBe('re_9');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the resent refund is still pending', async () => {
    const pending = storedRefund({ stripeRefundId: undefined });
    const { service, gateway, notifications } = fakes(
      pending,
      storedRefund({ stripeRefundId: 're_9' }),
    );
    gateway.createRefund.mockResolvedValue({
      id: 're_9',
      status: 'pending',
      amount: 12550,
      currency: 'usd',
      paymentIntentId: 'pi_1',
    });

    await service.resubmit(pending);

    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('RefundsService with several refunds per payment (FLT-27)', () => {
  const CHANGE_ID = '6740f1c2a4b5c6d7e8f90ccc';
  const FLIGHT_PAYMENT = payment({ amount: 25100 });

  type Doc = Record<string, unknown> & { _id: Types.ObjectId };

  /**
   * A fake collection that keeps several refunds per payment (unique per
   * bookingType + bookingId), several payments by key, and a module reference
   * that may hold the flight change port.
   */
  function many(
    options: {
      payments?: Record<string, unknown>[];
      port?: { linkOf: jest.Mock } | null;
    } = {},
  ) {
    const paymentList = options.payments ?? [FLIGHT_PAYMENT];
    const stored: Doc[] = [];
    const keyOf = (doc: Record<string, unknown>) =>
      `${String(doc.bookingType)}-${String(doc.bookingId)}`;
    const refunds = {
      create: jest.fn((doc: Record<string, unknown>) => {
        if (stored.some((refund) => keyOf(refund) === keyOf(doc))) {
          return Promise.reject(duplicateKey());
        }
        const saved: Doc = {
          _id: new Types.ObjectId(),
          ...doc,
          createdAt: NOW,
          updatedAt: NOW,
        };
        stored.push(saved);
        return Promise.resolve({ toObject: () => ({ ...saved }) });
      }),
      findOne: jest.fn((filter: Record<string, unknown>) =>
        query(
          stored.find((refund) =>
            filter.stripeRefundId
              ? refund.stripeRefundId === filter.stripeRefundId
              : keyOf(refund) === keyOf(filter),
          ) ?? null,
        ),
      ),
      find: jest.fn((filter: { paymentId?: unknown }) =>
        query(
          stored.filter(
            (refund) =>
              String(refund.paymentId) === String(filter.paymentId) &&
              refund.status !== RefundStatus.Failed,
          ),
        ),
      ),
      findOneAndUpdate: jest.fn(
        (
          filter: { _id: unknown; status?: unknown },
          update: { $set: Record<string, unknown> },
        ) => {
          const refund = stored.find(
            (doc) =>
              String(doc._id) === String(filter._id) &&
              (filter.status === undefined || doc.status === filter.status),
          );
          if (refund) Object.assign(refund, update.$set);
          return query(refund ? { ...refund } : null);
        },
      ),
      findById: jest.fn((id: unknown) =>
        query(stored.find((doc) => String(doc._id) === String(id)) ?? null),
      ),
      deleteOne: jest.fn((filter: { _id: unknown }) => {
        const index = stored.findIndex(
          (doc) => String(doc._id) === String(filter._id),
        );
        if (index >= 0) stored.splice(index, 1);
        return query({ deletedCount: index >= 0 ? 1 : 0 });
      }),
    };
    const payments = {
      findOne: jest.fn((filter: Record<string, unknown>) =>
        query(
          paymentList.find(
            (candidate) =>
              keyOf(candidate) === keyOf(filter) &&
              candidate.status === filter.status,
          ) ?? null,
        ),
      ),
      findById: jest.fn(() => query(paymentList[0])),
    };
    let sent = 0;
    const gateway = {
      createRefund: jest.fn((input: { amount: number }) => {
        sent += 1;
        return Promise.resolve({
          id: `re_${sent}`,
          status: 'pending',
          amount: input.amount,
          currency: 'usd',
          paymentIntentId: 'pi_1',
        });
      }),
    };
    const notifications = { notify: jest.fn(() => Promise.resolve()) };
    const moduleRef = {
      get: jest.fn(() => {
        if (!options.port) throw new Error('not found');
        return options.port;
      }),
    };
    const service = new RefundsService(
      refunds as never,
      payments as never,
      gateway as unknown as StripeGateway,
      notifications as unknown as NotificationsService,
      moduleRef as unknown as ModuleRef,
    );
    return { service, refunds, gateway, notifications, moduleRef, stored };
  }

  const fareDifference = (fields: Record<string, unknown> = {}) => ({
    bookingType: BookingType.FlightChange,
    bookingId: CHANGE_ID,
    paymentOf: { bookingType: BookingType.Flight, bookingId: BOOKING_ID },
    amount: 4000,
    reason: RefundReason.FareDifference,
    link: { bookingType: BookingType.Flight, bookingId: BOOKING_ID } as const,
    ...fields,
  });

  describe('refund: the remaining amount', () => {
    it('refunds the percent of the whole payment when nothing was refunded before (unchanged)', async () => {
      const { service } = many();

      await expect(
        service.refund(request({ refundPercent: 50 })),
      ).resolves.toMatchObject({ amount: 12550, refundPercent: 50 });
    });

    it('takes the percent of what is left after a fare difference refund', async () => {
      const { service } = many();
      await service.refundAmount(fareDifference());

      // (25100 - 4000) x 50% = 10550
      await expect(
        service.refund(request({ refundPercent: 50 })),
      ).resolves.toMatchObject({ amount: 10550, refundPercent: 50 });
    });

    it('ignores a failed earlier refund: it gave nothing back', async () => {
      const { service, stored } = many();
      await service.refundAmount(fareDifference());
      stored[0].status = RefundStatus.Failed;

      await expect(
        service.refund(request({ refundPercent: 50 })),
      ).resolves.toMatchObject({ amount: 12550 });
    });

    it('rounds the share of the remainder to whole minor units', async () => {
      const { service } = many();
      await service.refundAmount(fareDifference({ amount: 3999 }));

      // (25100 - 3999) x 33% = 6963.33 -> 6963
      await expect(
        service.refund(request({ refundPercent: 33 })),
      ).resolves.toMatchObject({ amount: 6963 });
    });

    it('creates nothing for 0%, and nothing when the whole payment was already refunded', async () => {
      const { service, gateway } = many();
      await expect(
        service.refund(request({ refundPercent: 0 })),
      ).resolves.toBeNull();
      await service.refundAmount(fareDifference({ amount: 25100 }));

      await expect(service.refund(request())).resolves.toBeNull();
      expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    });

    it('never counts its own key: a retried cancellation returns the first refund unchanged', async () => {
      const { service, gateway } = many();
      await service.refundAmount(fareDifference());
      const first = await service.refund(request({ refundPercent: 100 }));

      const again = await service.refund(request({ refundPercent: 100 }));

      expect(first).toMatchObject({ amount: 21100 });
      expect(again).toEqual(first);
      expect(gateway.createRefund).toHaveBeenCalledTimes(2);
    });

    it('lets money out never exceed money in: fare difference plus a 100% cancellation equals the payment', async () => {
      const { service, stored } = many();
      await service.refundAmount(fareDifference({ amount: 7777 }));
      await service.refund(request({ refundPercent: 100 }));

      const total = stored.reduce(
        (sum, refund) => sum + (refund.amount as number),
        0,
      );
      expect(total).toBe(25100);
    });
  });

  describe('refundAmount', () => {
    it('records the exact amount against the payment of paymentOf, keyed on the change, then sends it to Stripe', async () => {
      const { service, refunds, gateway } = many();

      const refund = await service.refundAmount(fareDifference());

      expect(refunds.create).toHaveBeenCalledWith({
        bookingType: BookingType.FlightChange,
        bookingId: new Types.ObjectId(CHANGE_ID),
        paymentId: PAYMENT_ID,
        userId: USER_ID,
        amount: 4000,
        currency: 'USD',
        refundPercent: 16,
        reason: RefundReason.FareDifference,
        status: RefundStatus.Pending,
      });
      expect(gateway.createRefund).toHaveBeenCalledWith(
        {
          paymentIntentId: 'pi_1',
          amount: 4000,
          metadata: {
            bookingType: BookingType.FlightChange,
            bookingId: CHANGE_ID,
          },
        },
        `refund-flight_change-${CHANGE_ID}`,
      );
      expect(refund).toMatchObject({
        bookingType: 'flight_change',
        bookingId: CHANGE_ID,
        paymentId: PAYMENT_ID.toString(),
        amount: 4000,
        reason: 'fare_difference',
        status: 'pending',
        stripeRefundId: 're_1',
      });
    });

    it('notifies the owner with the fare difference text, linked to the flight booking', async () => {
      const { service, notifications } = many();

      await service.refundAmount(fareDifference());

      expect(notifications.notify).toHaveBeenCalledWith(
        USER_ID,
        NotificationType.Refund,
        'Your new flight costs less: the fare difference of 40.00 USD is being refunded to your card.',
        { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
      );
    });

    it('is idempotent: a second call returns the first refund, Stripe and the notification once', async () => {
      const { service, gateway, notifications } = many();

      const first = await service.refundAmount(fareDifference());
      const second = await service.refundAmount(
        fareDifference({ amount: 9999 }),
      );

      expect(second).toEqual(first);
      expect(gateway.createRefund).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('returns the first refund when two calls race and the insert hits the unique index', async () => {
      const { service, refunds, gateway } = many();
      const first = await service.refundAmount(fareDifference());
      // The other call recorded it between our read and our insert.
      refunds.findOne.mockReturnValueOnce(query(null));

      await expect(service.refundAmount(fareDifference())).resolves.toEqual(
        first,
      );
      expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    });

    it('answers 409 above what is left of the payment and records nothing; exactly the remainder is allowed', async () => {
      const { service, refunds, gateway } = many();
      await service.refund(request({ refundPercent: 50 })); // 12550 left

      await expect(
        service.refundAmount(fareDifference({ amount: 12551 })),
      ).rejects.toThrow(new ConflictException(REFUND_EXCEEDS_PAYMENT_MESSAGE));
      expect(refunds.create).toHaveBeenCalledTimes(1);
      expect(gateway.createRefund).toHaveBeenCalledTimes(1);

      await expect(
        service.refundAmount(fareDifference({ amount: 12550 })),
      ).resolves.toMatchObject({ amount: 12550 });
    });

    it('removes its own refund by id and answers 409 when a refund made at the same moment would exceed the payment', async () => {
      const { service, refunds, gateway, stored } = many();
      const create = refunds.create.getMockImplementation();
      refunds.create.mockImplementationOnce((doc) => {
        // Another refund of the same payment is recorded in the same instant.
        stored.push({
          _id: new Types.ObjectId(),
          bookingType: BookingType.Flight,
          bookingId: new Types.ObjectId(BOOKING_ID),
          paymentId: PAYMENT_ID,
          amount: 25000,
          status: RefundStatus.Pending,
        });
        return create!(doc);
      });

      await expect(service.refundAmount(fareDifference())).rejects.toThrow(
        ConflictException,
      );
      expect(refunds.deleteOne).toHaveBeenCalledTimes(1);
      expect(stored.map((refund) => refund.amount)).toEqual([25000]);
      expect(gateway.createRefund).not.toHaveBeenCalled();
    });

    it('leaves the refund pending when Stripe is down, does not throw, and still notifies', async () => {
      const { service, gateway, notifications } = many();
      gateway.createRefund.mockRejectedValueOnce(
        new ServiceUnavailableException('Payments are not configured'),
      );

      await expect(
        service.refundAmount(fareDifference()),
      ).resolves.toMatchObject({ status: 'pending', stripeRefundId: null });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('answers 404 when paymentOf has no succeeded payment', async () => {
      const { service, refunds } = many({ payments: [] });

      await expect(service.refundAmount(fareDifference())).rejects.toThrow(
        new NotFoundException('Payment not found'),
      );
      expect(refunds.create).not.toHaveBeenCalled();
    });

    it('creates nothing for 0 and refuses a negative or fractional amount', async () => {
      const { service, refunds } = many();

      await expect(
        service.refundAmount(fareDifference({ amount: 0 })),
      ).resolves.toBeNull();
      for (const amount of [-1, 10.5]) {
        await expect(
          service.refundAmount(fareDifference({ amount })),
        ).rejects.toBeInstanceOf(RangeError);
      }
      expect(refunds.create).not.toHaveBeenCalled();
    });
  });

  describe('the notification link of a flight change refund', () => {
    const changePayment = payment({
      bookingType: BookingType.FlightChange,
      bookingId: new Types.ObjectId(CHANGE_ID),
      amount: 4200,
    });
    const late = request({
      bookingType: BookingType.FlightChange,
      bookingId: CHANGE_ID,
      reason: RefundReason.LatePayment,
    });

    it('asks the flight change port for the booking when no link is given (late payment)', async () => {
      const port = {
        linkOf: jest.fn(() =>
          Promise.resolve({
            bookingType: BookingType.Flight,
            bookingId: BOOKING_ID,
          }),
        ),
      };
      const { service, notifications, moduleRef } = many({
        payments: [changePayment],
        port,
      });

      await service.refund(late);

      expect(moduleRef.get).toHaveBeenCalledWith(FLIGHT_CHANGE_PAYMENT_PORT, {
        strict: false,
      });
      expect(port.linkOf).toHaveBeenCalledWith(CHANGE_ID);
      expect(notifications.notify).toHaveBeenCalledWith(
        USER_ID,
        NotificationType.Refund,
        'Your payment arrived after your booking hold ended, so it is being refunded in full (42.00 USD).',
        { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
      );
    });

    it('notifies without a link when no port is provided', async () => {
      const { service, notifications } = many({
        payments: [changePayment],
        port: null,
      });

      await service.refund(late);

      expect(notifications.notify).toHaveBeenCalledWith(
        USER_ID,
        NotificationType.Refund,
        expect.any(String),
        undefined,
      );
    });

    it('notifies without a link, and logs, when the port fails', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const port = { linkOf: jest.fn(() => Promise.reject(new Error('db'))) };
      const { service, notifications } = many({
        payments: [changePayment],
        port,
      });

      await service.refund(late);

      expect(notifications.notify).toHaveBeenCalledWith(
        USER_ID,
        NotificationType.Refund,
        expect.any(String),
        undefined,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(CHANGE_ID));
    });

    it('reconciles a fare_difference refund from the webhook and links its second notification through the port', async () => {
      const port = {
        linkOf: jest.fn(() =>
          Promise.resolve({
            bookingType: BookingType.Flight,
            bookingId: BOOKING_ID,
          }),
        ),
      };
      const { service, notifications, stored } = many({ port });
      await service.refundAmount(fareDifference());

      await service.applyStripeStatus('re_1', 'succeeded');

      expect(stored[0].status).toBe(RefundStatus.Refunded);
      expect(notifications.notify).toHaveBeenLastCalledWith(
        USER_ID,
        NotificationType.Refund,
        'Your refund of 40.00 USD for your flight booking has been sent to your card.',
        { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
      );
      expect(port.linkOf).toHaveBeenCalledWith(CHANGE_ID);
    });
  });
});

describe('percentOf (FLT-27)', () => {
  it.each([
    [4000, 25100, 16],
    [1, 25100, 1],
    [25100, 25100, 100],
    [12550, 25100, 50],
  ])('%p of %p is %p%%', (amount, total, percent) => {
    expect(percentOf(amount, total)).toBe(percent);
  });
});
