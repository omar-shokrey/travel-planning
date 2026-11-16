import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';
import { Itinerary, ItinerarySchema } from './models/itinerary.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ReferenceModule,
  ],
  controllers: [
    ItinerariesController,
    ActivitiesController,
    TransportCostsController,
  ],
  providers: [ItinerariesService, ActivitiesService, TransportCostsService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
