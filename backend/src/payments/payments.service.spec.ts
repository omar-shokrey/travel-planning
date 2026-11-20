import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { BookingPoliciesService } from './booking-policies.service';
import { BookingType } from './enums/booking-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import type {
  FlightChangePayable,
  FlightChangePaymentPort,
} from './flight-change-payment-port';
import type { Payment } from './models/payment.schema';
import {
  ALREADY_PAID_MESSAGE,
  BOOKING_NOT_FOUND_MESSAGE,
  HOLD_EXPIRED_MESSAGE,
  PAYMENT_CANCELLED_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_UNAVAILABLE_MESSAGE,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from './payments.constants';
import { PaymentsService } from './payments.service';
import type { GatewayIntent, StripeGateway } from './stripe.gateway';

const PAYMENT = '6740f1c2a4b5c6d7e8f90abc';
const BOOKING = '6740f1c2a4b5c6d7e8f90789';
const USER = '6740f1c2a4b5c6d7e8f90123';
const HOLD_END = new Date('2026-11-20T10:10:00.000Z');
const CREATED = new Date('2026-11-20T10:00:00.000Z');

const payable = {
  type: BookingType.Flight,
  bookingId: BOOKING,
  total: 52500,
  currency: 'USD',
  holdExpiresAt: HOLD_END,
};

const stored = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(PAYMENT),
  bookingType: BookingType.Flight,
  bookingId: new Types.ObjectId(BOOKING),
  userId: new Types.ObjectId(USER),
  stripePaymentIntentId: 'pi_1',
  amount: 52500,
  currency: 'USD',
  status: PaymentStatus.RequiresPayment,
  holdExpiresAt: HOLD_END,
  createdAt: CREATED,
  updatedAt: CREATED,
  ...fields,
});

const intent = (fields: Partial<GatewayIntent> = {}): GatewayIntent => ({
  id: 'pi_1',
  status: 'requires_payment_method',
  clientSecret: 'pi_1_secret_abc',
  amount: 52500,
  currency: 'usd',
  ...fields,
});

/** What `.lean().exec()` of a Mongoose query gives. */
interface Query<T> {
  lean: () => Query<T>;
  exec: () => Promise<T>;
}
const query = <T>(value: T): Query<T> => {
  const chain: Query<T> = {
    lean: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
};

function setup(
  options: {
    found?: unknown;
    reopened?: unknown;
    payable?: unknown;
    gatewayIntent?: GatewayIntent;
  } = {},
) {
  const model = {
    findOne: jest.fn((): Query<unknown> => query(options.found ?? null)),
    findOneAndUpdate: jest.fn((): Query<unknown> =>
      query(options.reopened ?? null),
    ),
    create: jest.fn(() => Promise.resolve({ toObject: () => stored() })),
  };
  const policies = {
    findPayableOrThrow: jest.fn(() =>
      options.payable instanceof Error
        ? Promise.reject(options.payable)
        : Promise.resolve(options.payable ?? payable),
    ),
  };
  const gateway = {
    createPaymentIntent: jest.fn(() =>
      Promise.resolve(options.gatewayIntent ?? intent()),
    ),
    retrievePaymentIntent: jest.fn(() =>
      Promise.resolve(options.gatewayIntent ?? intent()),
    ),
  };
  const service = new PaymentsService(
    model as unknown as Model<Payment>,
    policies as unknown as BookingPoliciesService,
    gateway as unknown as StripeGateway,
  );
  return { service, model, policies, gateway };
}

async function failureOf(call: Promise<unknown>): Promise<Error> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error('the call did not fail');
  return error;
}

const dto = { bookingType: BookingType.Flight, bookingId: BOOKING };

describe('PaymentsService.start (PAY-01)', () => {
  it('pays the booking total in the booking currency, never an amount from the client', async () => {
    const { service, policies, gateway } = setup();

    await service.start(USER, dto);

    expect(policies.findPayableOrThrow).toHaveBeenCalledWith(
      BookingType.Flight,
      BOOKING,
      USER,
      expect.any(Date),
    );
    expect(gateway.createPaymentIntent).toHaveBeenCalledWith(
      {
        amount: 52500,
        currency: 'USD',
        bookingType: 'flight',
        bookingId: BOOKING,
      },
      `payment-flight-${BOOKING}`,
    );
  });

  it('stores only the Stripe id, the amount, the currency, the status and the hold', async () => {
    const { service, model } = setup();

    await service.start(USER, dto);

    expect(model.create).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(BOOKING),
      userId: new Types.ObjectId(USER),
      stripePaymentIntentId: 'pi_1',
      amount: 52500,
      currency: 'USD',
      status: PaymentStatus.RequiresPayment,
      holdExpiresAt: HOLD_END,
    });
  });

  it('answers with the payment and the client secret, without the owner', async () => {
    const { service } = setup();

    const response = await service.start(USER, dto);

    expect(response).toEqual({
      id: PAYMENT,
      bookingType: 'flight',
      bookingId: BOOKING,
      stripePaymentIntentId: 'pi_1',
      amount: 52500,
      currency: 'USD',
      status: 'requires_payment',
      holdExpiresAt: '2026-11-20T10:10:00.000Z',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z',
      clientSecret: 'pi_1_secret_abc',
    });
  });

  it.each([
    ['not accepted', new ConflictException(POLICIES_NOT_ACCEPTED_MESSAGE)],
    ['expired', new ConflictException(HOLD_EXPIRED_MESSAGE)],
    ['not theirs', new NotFoundException('Booking not found')],
  ])(
    'does not call Stripe or save anything when the booking is not payable (%s)',
    async (_name, error) => {
      const { service, model, gateway } = setup({ payable: error });

      expect(await failureOf(service.start(USER, dto))).toBe(error);
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
      expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it('returns the same PaymentIntent when the payment already waits for the card', async () => {
    const { service, model, gateway } = setup({ found: stored() });

    const response = await service.start(USER, dto);

    expect(response.id).toBe(PAYMENT);
    expect(response.clientSecret).toBe('pi_1_secret_abc');
    expect(gateway.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it.each([
    [PaymentStatus.Succeeded, ALREADY_PAID_MESSAGE],
    [PaymentStatus.Failed, PAYMENT_FAILED_MESSAGE],
    [PaymentStatus.Cancelled, PAYMENT_CANCELLED_MESSAGE],
  ])('answers 409 when the existing payment is %s', async (status, message) => {
    const { service, gateway } = setup({ found: stored({ status }) });

    const error = await failureOf(service.start(USER, dto));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(message);
    expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('returns the payment that another request created first (unique index)', async () => {
    const { service, model } = setup();
    model.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(stored()));
    model.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );

    const response = await service.start(USER, dto);

    expect(response.id).toBe(PAYMENT);
    expect(response.clientSecret).toBe('pi_1_secret_abc');
  });

  it('rethrows any other database error', async () => {
    const { service, model } = setup();
    const broken = new Error('connection lost');
    model.create.mockRejectedValueOnce(broken);

    expect(await failureOf(service.start(USER, dto))).toBe(broken);
  });

  it('answers 502 when Stripe returns an intent with no client secret', async () => {
    const { service } = setup({
      gatewayIntent: intent({ clientSecret: null }),
    });

    const error = await failureOf(service.start(USER, dto));

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe(PAYMENT_UNAVAILABLE_MESSAGE);
  });
});

describe('PaymentsService.retry (PAY-01)', () => {
  it('looks for the payment of this user only, and answers 404 otherwise', async () => {
    const { service, model, gateway } = setup();

    const error = await failureOf(service.retry(PAYMENT, USER));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(PAYMENT_NOT_FOUND_MESSAGE);
    expect(model.findOne).toHaveBeenCalledWith({
      _id: PAYMENT,
      userId: new Types.ObjectId(USER),
    });
    expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('moves a failed payment back to requires_payment and returns the same PaymentIntent', async () => {
    const { service, model, gateway } = setup({
      found: stored({ status: PaymentStatus.Failed }),
      reopened: stored({ status: PaymentStatus.RequiresPayment }),
    });

    const response = await service.retry(PAYMENT, USER);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId), status: PaymentStatus.Failed },
      { $set: { status: PaymentStatus.RequiresPayment } },
      { returnDocument: 'after' },
    );
    expect(response.status).toBe('requires_payment');
    expect(response.clientSecret).toBe('pi_1_secret_abc');
    expect(gateway.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
  });

  it('checks that the booking can still be paid before it asks Stripe', async () => {
    const holdOver = new ConflictException(HOLD_EXPIRED_MESSAGE);
    const { service, policies, gateway } = setup({
      found: stored({ status: PaymentStatus.Failed }),
      payable: holdOver,
    });

    expect(await failureOf(service.retry(PAYMENT, USER))).toBe(holdOver);
    expect(policies.findPayableOrThrow).toHaveBeenCalledWith(
      BookingType.Flight,
      BOOKING,
      USER,
      expect.any(Date),
    );
    expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('returns a payment that still waits for the card without changing it', async () => {
    const { service, model } = setup({ found: stored() });

    const response = await service.retry(PAYMENT, USER);

    expect(response.status).toBe('requires_payment');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [PaymentStatus.Succeeded, ALREADY_PAID_MESSAGE],
    [PaymentStatus.Cancelled, PAYMENT_CANCELLED_MESSAGE],
  ])('refuses to retry a %s payment', async (status, message) => {
    const { service, gateway } = setup({ found: stored({ status }) });

    const error = await failureOf(service.retry(PAYMENT, USER));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(message);
    expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it.each([
    ['succeeded', ALREADY_PAID_MESSAGE],
    ['canceled', PAYMENT_CANCELLED_MESSAGE],
  ])(
    'answers 409 when Stripe says the PaymentIntent is %s',
    async (status, message) => {
      const { service, model } = setup({
        found: stored({ status: PaymentStatus.Failed }),
        gatewayIntent: intent({ status }),
      });

      const error = await failureOf(service.retry(PAYMENT, USER));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(message);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('reads the payment again when another retry reopened it first', async () => {
    const { service, model } = setup({
      found: stored({ status: PaymentStatus.Failed }),
      reopened: null,
    });
    model.findOne
      .mockReturnValueOnce(query(stored({ status: PaymentStatus.Failed })))
      .mockReturnValueOnce(query(stored()));

    const response = await service.retry(PAYMENT, USER);

    expect(response.status).toBe('requires_payment');
  });
});

describe('PaymentsService.findOne (PAY-01)', () => {
  it('shows the status of the user’s own payment, never the client secret', async () => {
    const { service, gateway } = setup({
      found: stored({ status: PaymentStatus.Succeeded }),
    });

    const response = await service.findOne(PAYMENT, USER);

    expect(response.status).toBe('succeeded');
    expect(response).not.toHaveProperty('clientSecret');
    expect(response).not.toHaveProperty('userId');
    expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing payment or someone else’s', async () => {
    const { service } = setup();

    const error = await failureOf(service.findOne(PAYMENT, USER));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(PAYMENT_NOT_FOUND_MESSAGE);
  });
});

describe('PaymentsService for a flight change (FLT-27)', () => {
  const CHANGE = '6740f1c2a4b5c6d7e8f90ccc';
  const changeDto = {
    bookingType: BookingType.FlightChange,
    bookingId: CHANGE,
  };
  // The service checks the port's hold against the real clock.
  const CHANGE_HOLD_END = new Date(Date.now() + 10 * 60 * 1000);

  function setupChange(port?: Partial<FlightChangePaymentPort>) {
    const base = setup();
    const service = new PaymentsService(
      base.model as unknown as Model<Payment>,
      base.policies as unknown as BookingPoliciesService,
      base.gateway as unknown as StripeGateway,
      port as FlightChangePaymentPort | undefined,
    );
    return { ...base, service };
  }

  const changePort = (
    payableChange: Partial<FlightChangePayable> = {},
  ): Partial<FlightChangePaymentPort> & {
    findPayable: jest.Mock;
  } => ({
    findPayable: jest.fn(() =>
      Promise.resolve({
        amount: 4200,
        currency: 'USD',
        holdExpiresAt: CHANGE_HOLD_END,
        ...payableChange,
      }),
    ),
  });

  it('answers 404 "Booking not found" while no flight change port is provided, and calls nothing', async () => {
    const { service, policies, gateway, model } = setupChange();

    const error = await failureOf(service.start(USER, changeDto));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    expect(policies.findPayableOrThrow).not.toHaveBeenCalled();
    expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('charges the amount and currency the port gives, keyed on the change, and never asks the policy rules', async () => {
    const port = changePort();
    const { service, policies, gateway, model } = setupChange(port);

    await service.start(USER, changeDto);

    expect(port.findPayable).toHaveBeenCalledWith(
      CHANGE,
      USER,
      expect.any(Date),
    );
    expect(policies.findPayableOrThrow).not.toHaveBeenCalled();
    expect(gateway.createPaymentIntent).toHaveBeenCalledWith(
      {
        amount: 4200,
        currency: 'USD',
        bookingType: 'flight_change',
        bookingId: CHANGE,
      },
      `payment-flight_change-${CHANGE}`,
    );
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: BookingType.FlightChange,
        bookingId: new Types.ObjectId(CHANGE),
        amount: 4200,
        currency: 'USD',
        holdExpiresAt: CHANGE_HOLD_END,
      }),
    );
  });

  it("passes on the port's 404 and 409 and calls Stripe for neither", async () => {
    for (const failure of [
      new NotFoundException('Booking not found'),
      new ConflictException(HOLD_EXPIRED_MESSAGE),
    ]) {
      const port = changePort();
      port.findPayable.mockRejectedValueOnce(failure);
      const { service, gateway } = setupChange(port);

      await expect(service.start(USER, changeDto)).rejects.toBe(failure);
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    }
  });

  it.each([0, -100, 12.5])(
    'refuses an amount of %p from the port (never charges a wrong amount)',
    async (amount) => {
      const { service, gateway } = setupChange(changePort({ amount }));

      await expect(service.start(USER, changeDto)).rejects.toThrow(
        /whole number of at least 1/,
      );
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a currency other than USD', { currency: 'EUR' }, /must be USD/],
    [
      'a hold that has ended',
      { holdExpiresAt: new Date('2020-01-01T00:00:00.000Z') },
      /hold that is not live/,
    ],
  ])(
    'refuses %s from the port and calls Stripe for nothing',
    async (_name, fields, message) => {
      const { service, gateway, model } = setupChange(changePort(fields));

      await expect(service.start(USER, changeDto)).rejects.toThrow(message);
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it('does not retry a change payment once the port says it is no longer payable (409)', async () => {
    const port = changePort();
    port.findPayable.mockRejectedValueOnce(
      new ConflictException(HOLD_EXPIRED_MESSAGE),
    );
    const { service, model, gateway } = setupChange(port);
    model.findOne.mockReturnValueOnce(
      query(
        stored({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(CHANGE),
          status: PaymentStatus.Failed,
        }),
      ),
    );

    await expect(service.retry(PAYMENT, USER)).rejects.toThrow(
      new ConflictException(HOLD_EXPIRED_MESSAGE),
    );
    expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('retries a failed change payment only while the port still says it is payable', async () => {
    const port = changePort();
    const { service, model, policies } = setupChange(port);
    model.findOne.mockReturnValueOnce(
      query(
        stored({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(CHANGE),
          status: PaymentStatus.Failed,
        }),
      ),
    );
    model.findOneAndUpdate.mockReturnValueOnce(
      query(
        stored({
          bookingType: BookingType.FlightChange,
          bookingId: new Types.ObjectId(CHANGE),
        }),
      ),
    );

    const answer = await service.retry(PAYMENT, USER);

    expect(port.findPayable).toHaveBeenCalledWith(
      CHANGE,
      USER,
      expect.any(Date),
    );
    expect(policies.findPayableOrThrow).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ bookingType: 'flight_change' });
  });
});
