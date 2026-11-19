import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ReferenceModule } from '../reference/reference.module';
import { Airline, AirlineSchema } from './models/airline.schema';
import { Flight, FlightSchema } from './models/flight.schema';
import { AirlinesService } from './airlines.service';
import { AirlinesController } from './airlines.controller';
import { FlightCabinsController } from './flight-cabins.controller';
import { FlightCabinsService } from './flight-cabins.service';
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
    // The Airport model, read only, for the airports list and time zones (FLT-02).
    ReferenceModule,
  ],
  controllers: [AirlinesController, FlightsController, FlightCabinsController],
  providers: [AirlinesService, FlightsService, FlightCabinsService],
  exports: [AirlinesService],
})
export class FlightsModule {}
