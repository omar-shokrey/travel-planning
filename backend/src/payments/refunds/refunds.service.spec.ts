import {
  BadGatewayException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationLinkType } from '../../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../../notifications/notifications.service';
import { BookingType } from '../enums/booking-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import type { StripeGateway } from '../stripe.gateway';
import { RefundReason } from './enums/refund-reason.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { RefundsService } from './refunds.service';

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
