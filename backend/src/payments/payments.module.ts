import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import {
  BOOKING_PAYMENT_HANDLERS,
  type BookingPaymentHandlers,
  paymentHandlerOf,
} from './booking-payment-handler';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingPoliciesService } from './booking-policies.service';
import { BookingType } from './enums/booking-type.enum';
import { Payment, PaymentSchema } from './models/payment.schema';
import { StripeEvent, StripeEventSchema } from './models/stripe-event.schema';
import { PaymentExpiryService } from './payment-expiry.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeGateway } from './stripe.gateway';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
    // The booking modules own the bookings (PAY-02). They never import this
    // module, so there is no cycle.
    FlightBookingsModule,
    HotelBookingsModule,
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    StripeWebhookController,
  ],
  providers: [
    BookingPoliciesService,
    PaymentsService,
    StripeWebhookService,
    PaymentExpiryService,
    StripeGateway,
    {
      // PAY-01 -> FLT-23, HTL-17: who confirms a booking once its payment
      // succeeded. A booking service is a handler as soon as it has
      // `confirmPaid` (see booking-payment-handler.ts).
      provide: BOOKING_PAYMENT_HANDLERS,
      inject: [FlightBookingsService, HotelBookingsService],
      useFactory: (
        flightBookings: FlightBookingsService,
        hotelBookings: HotelBookingsService,
      ): BookingPaymentHandlers => ({
        [BookingType.Flight]: paymentHandlerOf(flightBookings),
        [BookingType.Hotel]: paymentHandlerOf(hotelBookings),
      }),
    },
  ],
  // BookingPoliciesService.findPayableOrThrow: the "payment is blocked until
  // the policies are accepted" rule, used by PaymentsService.
  exports: [BookingPoliciesService],
})
export class PaymentsModule {}
