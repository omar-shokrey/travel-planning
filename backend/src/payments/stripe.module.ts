import { Module } from '@nestjs/common';
import { StripeGateway } from './stripe.gateway';

/**
 * PAY-01 and PAY-03: the one StripeGateway. PaymentsModule and RefundsModule
 * both import this module, so they share one instance: a test that replaces a
 * gateway method replaces it everywhere.
 */
@Module({
  providers: [StripeGateway],
  exports: [StripeGateway],
})
export class StripeModule {}
