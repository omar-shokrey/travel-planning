import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads/uploads.module';
import { Airline, AirlineSchema } from './models/airline.schema';
import { Flight, FlightSchema } from './models/flight.schema';
import { AirlinesService } from './airlines.service';
import { AirlinesController } from './airlines.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
    UsersModule,
    UploadsModule,
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService],
})
export class FlightsModule {}
