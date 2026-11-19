import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { StripeWebhookController } from './stripe-webhook.controller';
import type { StripeWebhookService } from './stripe-webhook.service';

describe('StripeWebhookController (PAY-01)', () => {
  it('passes the raw body and the Stripe-Signature header to the service', async () => {
    const service = { handle: jest.fn().mockResolvedValue({ received: true }) };
    const controller = new StripeWebhookController(
      service as unknown as StripeWebhookService,
    );
    const rawBody = Buffer.from('{"id":"evt_1"}');

    await expect(
      controller.handle({ rawBody } as unknown as Request, 't=1,v1=abc'),
    ).resolves.toEqual({ received: true });
    expect(service.handle).toHaveBeenCalledWith(rawBody, 't=1,v1=abc');
  });

  it('is public (Stripe has no login: the signature is the authentication) and has no role', () => {
    const reflector = new Reflector();
    const handler = StripeWebhookController.prototype.handle;

    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        StripeWebhookController,
      ]),
    ).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
  });

  it('answers 200, as Stripe expects a 2xx', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        StripeWebhookController.prototype.handle,
      ),
    ).toBe(HttpStatus.OK);
  });
});
