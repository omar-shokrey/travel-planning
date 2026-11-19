import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { BookingPaymentHandlers } from './booking-payment-handler';
import { BookingType } from './enums/booking-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import type { Payment } from './models/payment.schema';
import type { StripeEvent } from './models/stripe-event.schema';
import {
  BOOKING_CONFIRMATION_UNAVAILABLE_MESSAGE,
  INVALID_SIGNATURE_MESSAGE,
} from './payments.constants';
import type { GatewayEvent, StripeGateway } from './stripe.gateway';
import { StripeWebhookService } from './stripe-webhook.service';

const PAYMENT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');
const RAW = Buffer.from('{"id":"evt_1"}');

const stored = (fields: Record<string, unknown> = {}) => ({
  _id: PAYMENT,
  bookingType: BookingType.Flight,
  bookingId: BOOKING,
  stripePaymentIntentId: 'pi_1',
  amount: 52500,
  currency: 'USD',
  status: PaymentStatus.RequiresPayment,
  ...fields,
});

const event = (
  type: string,
  intent: Partial<NonNullable<GatewayEvent['intent']>> | null = {},
): GatewayEvent => ({
  refund: null,
  id: `evt_${type}`,
  type,
  intent: intent && {
    id: 'pi_1',
    amount: 52500,
    amountReceived: 52500,
    currency: 'usd',
    ...intent,
  },
});

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
    payment?: unknown;
    seen?: boolean;
    handlers?: BookingPaymentHandlers;
    confirm?: boolean;
  } = {},
) {
  const payments = {
    findOne: jest.fn((): Query<unknown> => query(options.payment ?? null)),
    updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
  };
  const events = {
    exists: jest.fn(() => Promise.resolve(options.seen ? { _id: 'x' } : null)),
    create: jest.fn(() => Promise.resolve({})),
  };
  const confirmPaid = jest.fn(() => Promise.resolve(options.confirm ?? true));
  const gateway = { constructEvent: jest.fn() };
  const service = new StripeWebhookService(
    payments as unknown as Model<Payment>,
    events as unknown as Model<StripeEvent>,
    gateway as unknown as StripeGateway,
    options.handlers ?? { [BookingType.Flight]: { confirmPaid } },
  );
  return { service, payments, events, gateway, confirmPaid };
}

const deliver = (
  setupResult: ReturnType<typeof setup>,
  delivered: GatewayEvent,
) => {
  setupResult.gateway.constructEvent.mockReturnValue(delivered);
  return setupResult.service.handle(RAW, 't=1,v1=abc');
};

describe('StripeWebhookService: the signature (PAY-01)', () => {
  it.each([
    ['no body', undefined, 't=1,v1=abc'],
    ['no signature', RAW, undefined],
  ])(
    'answers 400 with %s and changes nothing',
    async (_name, body, signature) => {
      const s = setup();

      await expect(s.service.handle(body, signature)).rejects.toThrow(
        new BadRequestException(INVALID_SIGNATURE_MESSAGE),
      );
      expect(s.gateway.constructEvent).not.toHaveBeenCalled();
      expect(s.payments.updateOne).not.toHaveBeenCalled();
      expect(s.events.create).not.toHaveBeenCalled();
    },
  );

  it('passes the raw body and the header to the gateway, and changes nothing when it refuses them', async () => {
    const s = setup();
    s.gateway.constructEvent.mockImplementation(() => {
      throw new BadRequestException(INVALID_SIGNATURE_MESSAGE);
    });

    await expect(s.service.handle(RAW, 'bad')).rejects.toThrow(
      BadRequestException,
    );
    expect(s.gateway.constructEvent).toHaveBeenCalledWith(RAW, 'bad');
    expect(s.payments.findOne).not.toHaveBeenCalled();
    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.events.create).not.toHaveBeenCalled();
  });

  it('lets a missing webhook secret (503) through', async () => {
    const s = setup();
    s.gateway.constructEvent.mockImplementation(() => {
      throw new ServiceUnavailableException('Payments are not configured');
    });

    await expect(s.service.handle(RAW, 'sig')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('StripeWebhookService: events that were already handled (PAY-01)', () => {
  it('ignores an event id it has seen: nothing is read, changed or confirmed', async () => {
    const s = setup({ seen: true, payment: stored() });

    await expect(
      deliver(s, event('payment_intent.succeeded')),
    ).resolves.toEqual({ received: true });
    expect(s.payments.findOne).not.toHaveBeenCalled();
    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.confirmPaid).not.toHaveBeenCalled();
    expect(s.events.create).not.toHaveBeenCalled();
  });

  it('remembers the event id and type after it was handled', async () => {
    const s = setup({ payment: stored() });

    await deliver(s, event('payment_intent.succeeded'));

    expect(s.events.create).toHaveBeenCalledWith({
      _id: 'evt_payment_intent.succeeded',
      type: 'payment_intent.succeeded',
      processedAt: expect.any(Date),
    });
  });

  it('does not remember an event whose handling failed, so Stripe sends it again', async () => {
    const s = setup({ payment: stored() });
    const broken = new Error('database down');
    s.confirmPaid.mockRejectedValueOnce(broken);

    await expect(deliver(s, event('payment_intent.succeeded'))).rejects.toBe(
      broken,
    );
    expect(s.events.create).not.toHaveBeenCalled();
  });

  it('accepts the same event delivered twice at the same moment', async () => {
    const s = setup({ payment: stored() });
    s.events.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );

    await expect(
      deliver(s, event('payment_intent.succeeded')),
    ).resolves.toEqual({ received: true });
  });

  it('rethrows another error from remembering the event', async () => {
    const s = setup({ payment: stored() });
    const broken = new Error('write failed');
    s.events.create.mockRejectedValueOnce(broken);

    await expect(deliver(s, event('payment_intent.succeeded'))).rejects.toBe(
      broken,
    );
  });
});

describe('StripeWebhookService: payment_intent.succeeded (PAY-01)', () => {
  it('marks the payment succeeded with a conditional update, then asks the booking module to confirm', async () => {
    const s = setup({ payment: stored() });

    await deliver(s, event('payment_intent.succeeded'));

    expect(s.payments.findOne).toHaveBeenCalledWith({
      stripePaymentIntentId: 'pi_1',
    });
    expect(s.payments.updateOne).toHaveBeenCalledWith(
      {
        _id: PAYMENT,
        status: {
          $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed],
        },
      },
      { $set: { status: PaymentStatus.Succeeded } },
    );
    expect(s.confirmPaid).toHaveBeenCalledWith(
      BOOKING.toString(),
      expect.any(Date),
    );
  });

  it('still asks for the confirmation when the payment was already marked (a retried event)', async () => {
    const s = setup({ payment: stored({ status: PaymentStatus.Succeeded }) });

    await deliver(s, event('payment_intent.succeeded'));

    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.confirmPaid).toHaveBeenCalledTimes(1);
  });

  it('asks the hotel handler for a hotel payment', async () => {
    const confirmHotel = jest.fn(() => Promise.resolve(true));
    const confirmFlight = jest.fn(() => Promise.resolve(true));
    const s = setup({
      payment: stored({ bookingType: BookingType.Hotel }),
      handlers: {
        [BookingType.Flight]: { confirmPaid: confirmFlight },
        [BookingType.Hotel]: { confirmPaid: confirmHotel },
      },
    });

    await deliver(s, event('payment_intent.succeeded'));

    expect(confirmHotel).toHaveBeenCalledWith(
      BOOKING.toString(),
      expect.any(Date),
    );
    expect(confirmFlight).not.toHaveBeenCalled();
  });

  it('is not an error when the hold had ended: the booking stays unconfirmed (to be refunded, PAY-03)', async () => {
    const s = setup({ payment: stored(), confirm: false });

    await expect(
      deliver(s, event('payment_intent.succeeded')),
    ).resolves.toEqual({ received: true });
    expect(s.payments.updateOne).toHaveBeenCalled();
  });

  it('keeps the payment succeeded but answers 503 and forgets the event when no module confirms bookings yet (FLT-23, HTL-17), so Stripe sends it again', async () => {
    const s = setup({ payment: stored(), handlers: {} });

    await expect(deliver(s, event('payment_intent.succeeded'))).rejects.toThrow(
      new ServiceUnavailableException(BOOKING_CONFIRMATION_UNAVAILABLE_MESSAGE),
    );
    expect(s.payments.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: { status: PaymentStatus.Succeeded },
    });
    expect(s.events.create).not.toHaveBeenCalled();
  });

  it('ignores a PaymentIntent it does not know', async () => {
    const s = setup({ payment: null });

    await expect(
      deliver(s, event('payment_intent.succeeded')),
    ).resolves.toEqual({ received: true });
    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.confirmPaid).not.toHaveBeenCalled();
  });

  it.each([
    ['a different amount', { amountReceived: 100 }],
    ['a different currency', { currency: 'eur' }],
  ])('does not confirm when Stripe received %s', async (_name, intent) => {
    const s = setup({ payment: stored() });

    await deliver(s, event('payment_intent.succeeded', intent));

    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.confirmPaid).not.toHaveBeenCalled();
  });

  it('does not confirm a payment that was cancelled', async () => {
    const s = setup({ payment: stored({ status: PaymentStatus.Cancelled }) });

    await deliver(s, event('payment_intent.succeeded'));

    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.confirmPaid).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService: the other events (PAY-01)', () => {
  it('moves a payment to failed only from requires_payment', async () => {
    const s = setup();

    await deliver(s, event('payment_intent.payment_failed'));

    expect(s.payments.updateOne).toHaveBeenCalledWith(
      {
        stripePaymentIntentId: 'pi_1',
        status: { $in: [PaymentStatus.RequiresPayment] },
      },
      { $set: { status: PaymentStatus.Failed } },
    );
    expect(s.confirmPaid).not.toHaveBeenCalled();
  });

  it('moves a payment to cancelled from requires_payment or failed', async () => {
    const s = setup();

    await deliver(s, event('payment_intent.canceled'));

    expect(s.payments.updateOne).toHaveBeenCalledWith(
      {
        stripePaymentIntentId: 'pi_1',
        status: {
          $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed],
        },
      },
      { $set: { status: PaymentStatus.Cancelled } },
    );
  });

  it('accepts and ignores other PaymentIntent events', async () => {
    const s = setup();

    await expect(deliver(s, event('payment_intent.created'))).resolves.toEqual({
      received: true,
    });
    expect(s.payments.updateOne).not.toHaveBeenCalled();
  });

  it('accepts and ignores events that are not about a PaymentIntent', async () => {
    const s = setup();

    await expect(deliver(s, event('customer.created', null))).resolves.toEqual({
      received: true,
    });
    expect(s.payments.updateOne).not.toHaveBeenCalled();
    expect(s.events.create).toHaveBeenCalled();
  });
});
