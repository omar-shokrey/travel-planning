import { Module } from '@nestjs/common';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingPoliciesService } from './booking-policies.service';

@Module({
  // The booking modules own the bookings (PAY-02). They never import this
  // module, so there is no cycle.
  imports: [FlightBookingsModule, HotelBookingsModule],
  controllers: [BookingPoliciesController],
  providers: [BookingPoliciesService],
  // BookingPoliciesService.findPayableOrThrow: the "payment is blocked until
  // the policies are accepted" rule for PAY-01.
  exports: [BookingPoliciesService],
})
export class PaymentsModule {}
