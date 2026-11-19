import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module';
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
    ]),
    // FlightSeatHoldsService: the flight owns the seat counters (FLT-22).
    FlightsModule,
  ],
  controllers: [FlightBookingsController],
  // FlightBookingExpiryService: the hold-expiry job (FLT-22).
  providers: [FlightBookingsService, FlightBookingExpiryService],
})
export class FlightBookingsModule {}
