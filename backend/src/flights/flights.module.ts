import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ReferenceModule } from '../reference/reference.module';
import { Airline, AirlineSchema } from './models/airline.schema';
import { Flight, FlightSchema } from './models/flight.schema';
import { AirlinesService } from './airlines.service';
import { AirlinesController } from './airlines.controller';
import { FlightCabinsController } from './flight-cabins.controller';
import { FlightDetailsController } from './flight-details.controller';
import { FlightDetailsService } from './flight-details.service';
import { FlightBookingLookup } from './flight-booking-lookup.service';
import { FlightCabinsService } from './flight-cabins.service';
import { FlightResponsesService } from './flight-responses.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightSeatHoldsService } from './flight-seat-holds.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
    UsersModule,
    UploadsModule,
    // The in-app notification of a time change (FLT-05, GEN-01).
    NotificationsModule,
    // The Airport model, read only, for the airports list and time zones (FLT-02).
    ReferenceModule,
  ],
  // FlightSearchController first: GET /flights/search must be matched before
  // any GET /flights/:id (FLT-17). flights.module.spec.ts checks the order.
  controllers: [
    FlightSearchController,
    FlightDetailsController,
    AirlinesController,
    FlightsController,
    FlightCabinsController,
  ],
  providers: [
    AirlinesService,
    FlightsService,
    FlightCabinsService,
    FlightResponsesService,
    FlightSearchService,
    FlightDetailsService,
    FlightBookingLookup,
    FlightSeatHoldsService,
  ],
  // FlightResponsesService: flight responses with local times (GEN-06) for
  // the flight-bookings module (FLT-23, FLT-25, FLT-29). FlightSeatHoldsService:
  // the only way a booking holds and releases a cabin's seats (FLT-22).
  exports: [AirlinesService, FlightResponsesService, FlightSeatHoldsService],
})
export class FlightsModule {}
