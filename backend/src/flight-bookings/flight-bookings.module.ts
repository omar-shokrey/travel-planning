import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module';
import { Flight, FlightSchema } from '../flights/models/flight.schema';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingsController } from './flight-bookings.controller';
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
  ],
  controllers: [FlightBookingsController],
  // FlightBookingExpiryService: the hold-expiry job (FLT-22).
  providers: [FlightBookingsService, FlightBookingExpiryService],
  // FlightBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
