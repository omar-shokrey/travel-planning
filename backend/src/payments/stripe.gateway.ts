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

/** A verified webhook event. `intent` is set for the `payment_intent.*` events. */
export interface GatewayEvent {
  id: string;
  type: string;
  intent: {
    id: string;
    amount: number;
    amountReceived: number;
    currency: string;
  } | null;
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
