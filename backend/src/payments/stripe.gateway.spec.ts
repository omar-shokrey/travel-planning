import {
  BadGatewayException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  INVALID_SIGNATURE_MESSAGE,
  PAYMENT_UNAVAILABLE_MESSAGE,
  PAYMENTS_NOT_CONFIGURED_MESSAGE,
} from './payments.constants';
import { StripeGateway } from './stripe.gateway';

// The Stripe SDK is replaced: no test calls Stripe.
const mockCreate = jest.fn();
const mockRetrieve = jest.fn();
const mockCancel = jest.fn();
const mockRefundCreate = jest.fn();
const mockConstructEvent = jest.fn();
const mockStripe = jest.fn();
jest.mock('stripe', () => ({
  __esModule: true,
  default: function Stripe(key: string) {
    mockStripe(key);
    return {
      paymentIntents: {
        create: mockCreate,
        retrieve: mockRetrieve,
        cancel: mockCancel,
      },
      refunds: { create: mockRefundCreate },
      webhooks: { constructEvent: mockConstructEvent },
    };
  },
}));

const stripeIntent = (fields: Record<string, unknown> = {}) => ({
  id: 'pi_1',
  status: 'requires_payment_method',
  client_secret: 'pi_1_secret_abc',
  amount: 52500,
  amount_received: 0,
  currency: 'usd',
  ...fields,
});

function setup(settings: Partial<EnvironmentVariables> = {}) {
  const values: Partial<EnvironmentVariables> = {
    STRIPE_SECRET_KEY: 'sk_test_abc',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc',
    ...settings,
  };
  const config = {
    get: jest.fn((key: keyof EnvironmentVariables) => values[key]),
  };
  return new StripeGateway(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
}

const newIntent = {
  amount: 52500,
  currency: 'USD',
  bookingType: 'flight',
  bookingId: '6740f1c2a4b5c6d7e8f90789',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('StripeGateway: the PaymentIntent (PAY-01)', () => {
  it('creates a card-only intent in the platform currency with the idempotency key', async () => {
    mockCreate.mockResolvedValue(stripeIntent());

    const intent = await setup().createPaymentIntent(newIntent, 'payment-key');

    expect(mockStripe).toHaveBeenCalledWith('sk_test_abc');
    expect(mockCreate).toHaveBeenCalledWith(
      {
        amount: 52500,
        currency: 'usd',
        allowed_payment_method_types: ['card'],
        metadata: {
          bookingType: 'flight',
          bookingId: '6740f1c2a4b5c6d7e8f90789',
        },
      },
      { idempotencyKey: 'payment-key' },
    );
    expect(intent).toEqual({
      id: 'pi_1',
      status: 'requires_payment_method',
      clientSecret: 'pi_1_secret_abc',
      amount: 52500,
      currency: 'usd',
    });
  });

  it('retrieves and cancels an intent by id', async () => {
    mockRetrieve.mockResolvedValue(stripeIntent());
    mockCancel.mockResolvedValue(stripeIntent({ status: 'canceled' }));
    const gateway = setup();

    await expect(gateway.retrievePaymentIntent('pi_1')).resolves.toMatchObject({
      id: 'pi_1',
    });
    await expect(gateway.cancelPaymentIntent('pi_1')).resolves.toMatchObject({
      status: 'canceled',
    });
    expect(mockRetrieve).toHaveBeenCalledWith('pi_1');
    expect(mockCancel).toHaveBeenCalledWith('pi_1');
  });

  it('builds the Stripe client once', async () => {
    mockRetrieve.mockResolvedValue(stripeIntent());
    const gateway = setup();

    await gateway.retrievePaymentIntent('pi_1');
    await gateway.retrievePaymentIntent('pi_1');

    expect(mockStripe).toHaveBeenCalledTimes(1);
  });

  it('answers 503 and never builds a client when there is no secret key', async () => {
    const gateway = setup({ STRIPE_SECRET_KEY: '' });

    await expect(gateway.createPaymentIntent(newIntent, 'key')).rejects.toThrow(
      new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED_MESSAGE),
    );
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('answers 502 when Stripe fails, without passing its error on', async () => {
    mockCreate.mockRejectedValue(new Error('network down, key sk_test_abc'));

    const failure = await setup()
      .createPaymentIntent(newIntent, 'key')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadGatewayException);
    expect((failure as Error).message).toBe(PAYMENT_UNAVAILABLE_MESSAGE);
  });
});

describe('StripeGateway.constructEvent (PAY-01)', () => {
  const rawBody = Buffer.from('{"id":"evt_1"}');

  it('verifies the signature with the raw body and the webhook secret', () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: stripeIntent({ amount_received: 52500 }) },
    });

    const event = setup().constructEvent(rawBody, 't=1,v1=abc');

    expect(mockConstructEvent).toHaveBeenCalledWith(
      rawBody,
      't=1,v1=abc',
      'whsec_abc',
    );
    expect(event).toEqual({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      intent: {
        id: 'pi_1',
        amount: 52500,
        amountReceived: 52500,
        currency: 'usd',
      },
      refund: null,
    });
  });

  it('has no intent for an event that is not about a PaymentIntent', () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'customer.created',
      data: { object: { id: 'cus_1' } },
    });

    expect(setup().constructEvent(rawBody, 'sig').intent).toBeNull();
  });

  it('answers 400 for a signature that does not match', () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    expect(() => setup().constructEvent(rawBody, 'bad')).toThrow(
      new BadRequestException(INVALID_SIGNATURE_MESSAGE),
    );
  });

  it('answers 503 when the webhook secret is not set, before it checks anything', () => {
    expect(() =>
      setup({ STRIPE_WEBHOOK_SECRET: '' }).constructEvent(rawBody, 'sig'),
    ).toThrow(new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED_MESSAGE));
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it('answers 503, not 400, when there is no secret key to build the client', () => {
    expect(() =>
      setup({ STRIPE_SECRET_KEY: '' }).constructEvent(rawBody, 'sig'),
    ).toThrow(ServiceUnavailableException);
  });
});

describe('StripeGateway: refunds (PAY-03)', () => {
  const newRefund = {
    paymentIntentId: 'pi_1',
    amount: 26250,
    metadata: { bookingType: 'flight', bookingId: '6740f1c2a4b5c6d7e8f90789' },
  };
  const stripeRefund = (fields: Record<string, unknown> = {}) => ({
    id: 're_1',
    status: 'succeeded',
    amount: 26250,
    currency: 'usd',
    payment_intent: 'pi_1',
    ...fields,
  });

  it('refunds through the PaymentIntent with the amount, the metadata and the idempotency key', async () => {
    mockRefundCreate.mockResolvedValue(stripeRefund());

    const refund = await setup().createRefund(
      newRefund,
      'refund-flight-6740f1c2a4b5c6d7e8f90789',
    );

    expect(mockRefundCreate).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_1',
        amount: 26250,
        metadata: {
          bookingType: 'flight',
          bookingId: '6740f1c2a4b5c6d7e8f90789',
        },
      },
      { idempotencyKey: 'refund-flight-6740f1c2a4b5c6d7e8f90789' },
    );
    expect(refund).toEqual({
      id: 're_1',
      status: 'succeeded',
      amount: 26250,
      currency: 'usd',
      paymentIntentId: 'pi_1',
    });
  });

  it('reads the PaymentIntent id from an expanded intent, and a missing status as pending', async () => {
    mockRefundCreate.mockResolvedValue(
      stripeRefund({ payment_intent: { id: 'pi_2' }, status: null }),
    );

    await expect(setup().createRefund(newRefund, 'key')).resolves.toMatchObject(
      { paymentIntentId: 'pi_2', status: 'pending' },
    );
  });

  it('answers 502 when Stripe fails, without passing its error on', async () => {
    mockRefundCreate.mockRejectedValue(
      new Error('charge_already_refunded, key sk_test_abc'),
    );

    const failure = await setup()
      .createRefund(newRefund, 'key')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadGatewayException);
    expect((failure as Error).message).toBe(PAYMENT_UNAVAILABLE_MESSAGE);
  });

  it('answers 503 and calls nothing when there is no secret key', async () => {
    const failure = await setup({ STRIPE_SECRET_KEY: '' })
      .createRefund(newRefund, 'key')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it.each(['refund.created', 'refund.updated', 'refund.failed'])(
    'reads a %s event as a refund, with no intent',
    (type) => {
      mockConstructEvent.mockReturnValue({
        id: 'evt_r',
        type,
        data: { object: stripeRefund({ status: 'failed' }) },
      });

      expect(setup().constructEvent(Buffer.from('{}'), 't=1,v1=abc')).toEqual({
        id: 'evt_r',
        type,
        intent: null,
        refund: { id: 're_1', status: 'failed', paymentIntentId: 'pi_1' },
      });
    },
  );

  it('keeps a payment_intent event without a refund part', () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_p',
      type: 'payment_intent.payment_failed',
      data: { object: stripeIntent() },
    });

    const event = setup().constructEvent(Buffer.from('{}'), 'sig');

    expect(event.refund).toBeNull();
    expect(event.intent).toMatchObject({ id: 'pi_1' });
  });
});
