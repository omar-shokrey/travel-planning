import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module';
import { Flight, FlightSchema } from '../flights/models/flight.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { RefundsModule } from '../payments/refunds/refunds.module';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingConfirmationService } from './flight-booking-confirmation.service';
import { FlightBookingETicketService } from './flight-booking-e-ticket.service';
import { FlightBookingCompletionService } from './flight-booking-completion.service';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingListService } from './flight-booking-list.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightCancellationController } from './flight-cancellation.controller';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './models/flight-booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      // FLT-19: read only, for one light read of the flight's local
      // departure date and bag weight before the seats are held. The seats
      // themselves are changed only through FlightSeatHoldsService.
      { name: Flight.name, schema: FlightSchema },
    ]),
    // FlightSeatHoldsService: the flight owns the seat counters (FLT-22).
    FlightsModule,
    // FLT-23: the in-app notification of a confirmed booking (GEN-01). It
    // imports nothing of the booking modules, so there is no cycle.
    NotificationsModule,
    // FLT-26: the refund of a cancelled booking (PAY-03). RefundsModule
    // imports no booking module and not PaymentsModule, so there is no cycle.
    RefundsModule,
  ],
  // FlightCancellationController: POST /api/flights/:id/cancel (FLT-06).
  controllers: [FlightBookingsController, FlightCancellationController],
  // FlightBookingExpiryService: the hold-expiry job (FLT-22).
  // FlightBookingConfirmationService and FlightBookingETicketService: FLT-23.
  // FlightBookingCancellationService: FLT-26.
  providers: [
    FlightBookingsService,
    FlightBookingExpiryService,
    FlightBookingConfirmationService,
    FlightBookingETicketService,
    FlightBookingCancellationService,
    // GEN-11: the completion job (Confirmed -> Completed).
    FlightBookingCompletionService,
    // FLT-25: the user's lists of bookings and the details of one.
    FlightBookingListService,
    // FLT-06: the cancellation by the airline, its cascade and its hourly sweep.
    FlightCancellationService,
  ],
  // FlightBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
