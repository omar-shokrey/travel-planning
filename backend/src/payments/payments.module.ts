import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import {
  BOOKING_PAYMENT_HANDLERS,
  type BookingPaymentHandlers,
  paymentHandlersOf,
} from './booking-payment-handler';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingPoliciesService } from './booking-policies.service';
import {
  FLIGHT_CHANGE_PAYMENT_PORT,
  type FlightChangePaymentPort,
} from './flight-change-payment-port';
import { Payment, PaymentSchema } from './models/payment.schema';
import { StripeEvent, StripeEventSchema } from './models/stripe-event.schema';
import { PaymentExpiryService } from './payment-expiry.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsModule } from './refunds/refunds.module';
import { StripeModule } from './stripe.module';
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
    // The one StripeGateway, shared with the refunds (PAY-03).
    StripeModule,
    // RefundsService: the late-payment refund (PAY-03). RefundsModule imports
    // no booking module and not this one, so there is no cycle.
    RefundsModule,
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
    {
      // PAY-01 -> FLT-23, HTL-17: who confirms a booking once its payment
      // succeeded. A booking service is a handler as soon as it has
      // `confirmPaid` (see booking-payment-handler.ts). FLT-27: a flight
      // change is confirmed by the port the flight-bookings module provides;
      // until it does, there is no handler (and no payment) for it.
      provide: BOOKING_PAYMENT_HANDLERS,
      inject: [
        FlightBookingsService,
        HotelBookingsService,
        { token: FLIGHT_CHANGE_PAYMENT_PORT, optional: true },
      ],
      useFactory: (
        flightBookings: FlightBookingsService,
        hotelBookings: HotelBookingsService,
        flightChanges?: FlightChangePaymentPort,
      ): BookingPaymentHandlers =>
        paymentHandlersOf(flightBookings, hotelBookings, flightChanges),
    },
  ],
  // BookingPoliciesService.findPayableOrThrow: the "payment is blocked until
  // the policies are accepted" rule, used by PaymentsService.
  exports: [BookingPoliciesService],
})
export class PaymentsModule {}
