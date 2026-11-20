import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../../notifications/notifications.module';
import { Payment, PaymentSchema } from '../models/payment.schema';
import { StripeModule } from '../stripe.module';
import { Refund, RefundSchema } from './models/refund.schema';
import { RefundRecoveryService } from './refund-recovery.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

/**
 * PAY-03: refunds, as their own small module (development plan, section 15).
 * The bookings call RefundsService (FLT-26, HTL-21, FLT-06, FLT-27) and payments
 * calls the bookings, so this module imports NO booking module and not
 * PaymentsModule: FlightBookingsModule and HotelBookingsModule can import it
 * without a cycle. It reads payments only through the Payment model.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
    NotificationsModule,
    // The one StripeGateway, shared with PaymentsModule.
    StripeModule,
  ],
  controllers: [RefundsController],
  providers: [RefundsService, RefundRecoveryService],
  exports: [RefundsService],
})
export class RefundsModule {}
