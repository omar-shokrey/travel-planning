import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  INVALID_SIGNATURE_MESSAGE,
  PAYMENT_UNAVAILABLE_MESSAGE,
  PAYMENTS_NOT_CONFIGURED_MESSAGE,
} from './payments.constants';

/** A PaymentIntent as the rest of the module sees it: no Stripe type leaves this file. */
export interface GatewayIntent {
  id: string;
  /** Stripe's own status, such as `requires_payment_method` or `succeeded`. */
  status: string;
  /** What the frontend gives to Stripe Elements. Never stored, never logged. */
  clientSecret: string | null;
  amount: number;
  currency: string;
}

/** A refund as the rest of the module sees it (PAY-03). */
export interface GatewayRefund {
  id: string;
  /** Stripe's own status: `pending`, `requires_action`, `succeeded`, `failed` or `canceled`. */
  status: string;
  amount: number;
  currency: string;
  paymentIntentId: string | null;
}

/**
 * A verified webhook event. `intent` is set for the `payment_intent.*` events,
 * `refund` for the `refund.*` events (PAY-03); both are `null` otherwise.
 */
export interface GatewayEvent {
  id: string;
  type: string;
  intent: {
    id: string;
    amount: number;
    amountReceived: number;
    currency: string;
  } | null;
  refund: {
    id: string;
    status: string;
    paymentIntentId: string | null;
  } | null;
}

export interface NewRefund {
  paymentIntentId: string;
  /** Minor units, never more than the payment. */
  amount: number;
  metadata: { bookingType: string; bookingId: string };
}

export interface NewPaymentIntent {
  /** Minor units of the platform currency. */
  amount: number;
  currency: string;
  bookingType: string;
  bookingId: string;
}

/**
 * PAY-01: the only file that talks to Stripe (test mode). Card details never
 * reach the backend: the frontend confirms the PaymentIntent with Stripe
 * Elements, using the client secret this gateway returns. Stripe's types stop
 * here, so the services and their tests do not depend on the Stripe SDK.
 *
 * With no key set the app still starts; every call then answers 503.
 */
@Injectable()
export class StripeGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private client: Stripe | undefined;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Creates the PaymentIntent of a booking. The idempotency key makes two
   * requests for the same booking get the same PaymentIntent from Stripe.
   * Only cards: the card form is Stripe Elements, never this backend.
   */
  createPaymentIntent(
    intent: NewPaymentIntent,
    idempotencyKey: string,
  ): Promise<GatewayIntent> {
    return this.call('create the PaymentIntent', async (stripe) =>
      toGatewayIntent(
        await stripe.paymentIntents.create(
          {
            amount: intent.amount,
            currency: intent.currency.toLowerCase(),
            allowed_payment_method_types: ['card'],
            metadata: {
              bookingType: intent.bookingType,
              bookingId: intent.bookingId,
            },
          },
          { idempotencyKey },
        ),
      ),
    );
  }

  retrievePaymentIntent(id: string): Promise<GatewayIntent> {
    return this.call('retrieve the PaymentIntent', async (stripe) =>
      toGatewayIntent(await stripe.paymentIntents.retrieve(id)),
    );
  }

  /** Cancels the PaymentIntent when the hold ends. Stripe refuses one that already succeeded. */
  cancelPaymentIntent(id: string): Promise<GatewayIntent> {
    return this.call('cancel the PaymentIntent', async (stripe) =>
      toGatewayIntent(await stripe.paymentIntents.cancel(id)),
    );
  }

  /**
   * PAY-03: refunds a payment through its PaymentIntent (never a card). The
   * idempotency key makes a retried refund of the same booking reach Stripe
   * once, for 24 hours.
   */
  createRefund(
    refund: NewRefund,
    idempotencyKey: string,
  ): Promise<GatewayRefund> {
    return this.call('create the refund', async (stripe) =>
      toGatewayRefund(
        await stripe.refunds.create(
          {
            payment_intent: refund.paymentIntentId,
            amount: refund.amount,
            metadata: refund.metadata,
          },
          { idempotencyKey },
        ),
      ),
    );
  }

  /**
   * Checks the signature of a webhook call against the raw request body and
   * returns the event. 400 for a body or signature that does not match; 503
   * when the webhook secret is not set.
   */
  constructEvent(rawBody: Buffer, signature: string): GatewayEvent {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      throw new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED_MESSAGE);
    }
    let event: Stripe.Event;
    try {
      event = this.stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      // The message names the reason (a wrong signature or an old timestamp),
      // never the secret or the body.
      this.logger.warn(
        `Webhook rejected: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new BadRequestException(INVALID_SIGNATURE_MESSAGE);
    }
    return {
      id: event.id,
      type: event.type,
      intent: event.type.startsWith('payment_intent.')
        ? toEventIntent(event.data.object as unknown as Stripe.PaymentIntent)
        : null,
      // refund.created, refund.updated, refund.failed (PAY-03).
      refund: event.type.startsWith('refund.')
        ? toEventRefund(event.data.object as unknown as Stripe.Refund)
        : null,
    };
  }

  private stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get('STRIPE_SECRET_KEY', { infer: true });
      if (!key) {
        throw new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED_MESSAGE);
      }
      this.client = new Stripe(key);
    }
    return this.client;
  }

  /** Runs one Stripe call. A Stripe or network error is logged and answered with 502. */
  private async call<T>(
    action: string,
    run: (stripe: Stripe) => Promise<T>,
  ): Promise<T> {
    const stripe = this.stripe();
    try {
      return await run(stripe);
    } catch (error) {
      this.logger.error(
        `Could not ${action}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new BadGatewayException(PAYMENT_UNAVAILABLE_MESSAGE);
    }
  }
}

function toGatewayIntent(intent: Stripe.PaymentIntent): GatewayIntent {
  return {
    id: intent.id,
    status: intent.status,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
  };
}

function toEventIntent(intent: Stripe.PaymentIntent): GatewayEvent['intent'] {
  return {
    id: intent.id,
    amount: intent.amount,
    amountReceived: intent.amount_received,
    currency: intent.currency,
  };
}

/** The PaymentIntent of a refund is an id, or the expanded object. */
function paymentIntentIdOf(refund: Stripe.Refund): string | null {
  const intent = refund.payment_intent;
  if (!intent) return null;
  return typeof intent === 'string' ? intent : intent.id;
}

function toGatewayRefund(refund: Stripe.Refund): GatewayRefund {
  return {
    id: refund.id,
    status: refund.status ?? 'pending',
    amount: refund.amount,
    currency: refund.currency,
    paymentIntentId: paymentIntentIdOf(refund),
  };
}

function toEventRefund(refund: Stripe.Refund): GatewayEvent['refund'] {
  return {
    id: refund.id,
    status: refund.status ?? 'pending',
    paymentIntentId: paymentIntentIdOf(refund),
  };
}
