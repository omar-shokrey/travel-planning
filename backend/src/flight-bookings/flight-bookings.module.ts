import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module';
import { Flight, FlightSchema } from '../flights/models/flight.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { FLIGHT_CHANGE_PAYMENT_PORT } from '../payments/flight-change-payment-port';
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
import { FlightChangeController } from './flight-change.controller';
import { FlightChangeExpiryService } from './flight-change-expiry.service';
import { FlightChangePaymentService } from './flight-change-payment.service';
import { FlightChangeService } from './flight-change.service';
import { FlightSeatSelectionService } from './flight-seat-selection.service';
import { FlightSeatsController } from './flight-seats.controller';
import { FlightSeatsService } from './flight-seats.service';
import {
  FlightBookingChange,
  FlightBookingChangeSchema,
} from './models/flight-booking-change.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './models/flight-booking.schema';
import {
  FlightSeatAssignment,
  FlightSeatAssignmentSchema,
} from './models/flight-seat-assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      // FLT-19: read only, for one light read of the flight's local
      // departure date and bag weight before the seats are held. The seats
      // themselves are changed only through FlightSeatHoldsService.
      { name: Flight.name, schema: FlightSchema },
      // FLT-28: the chosen seats, a collection of this module.
      { name: FlightSeatAssignment.name, schema: FlightSeatAssignmentSchema },
      // FLT-27: the flight changes, a collection of this module.
      { name: FlightBookingChange.name, schema: FlightBookingChangeSchema },
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
  controllers: [
    FlightBookingsController,
    FlightSeatsController,
    FlightCancellationController,
    // PATCH /api/flight-bookings/:id/change-flight (FLT-27).
    FlightChangeController,
  ],
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
    FlightSeatsService,
    FlightSeatSelectionService,
    // FLT-27: the flight change, its job and the port the payments module
    // charges and confirms a change through.
    FlightChangeService,
    FlightChangeExpiryService,
    FlightChangePaymentService,
    {
      provide: FLIGHT_CHANGE_PAYMENT_PORT,
      useExisting: FlightChangePaymentService,
    },
  ],
  // FlightBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). FLIGHT_CHANGE_PAYMENT_PORT: how the payments
  // module charges and confirms a flight change (FLT-27). The payments module
  // imports this one, never the other way round.
  exports: [FlightBookingsService, FLIGHT_CHANGE_PAYMENT_PORT],
})
export class FlightBookingsModule {}
