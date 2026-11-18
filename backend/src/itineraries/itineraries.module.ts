import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { PublicItinerariesController } from './public-itineraries.controller';
import { PublicItinerariesService } from './public-itineraries.service';
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';
import { Itinerary, ItinerarySchema } from './models/itinerary.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ReferenceModule,
    UsersModule,
    // UploadsService: activity images (ITN-12, GEN-08).
    UploadsModule,
  ],
  controllers: [
    ItinerariesController,
    ActivitiesController,
    BudgetsController,
    TransportCostsController,
    PublicItinerariesController,
  ],
  providers: [
    ItinerariesService,
    ActivitiesService,
    ActivityImagesService,
    BudgetsService,
    TransportCostsService,
    PublicItinerariesService,
  ],
  // PublicItinerariesService: the public author page of the blog (BLG-12).
  exports: [ItinerariesService, PublicItinerariesService],
})
export class ItinerariesModule {}
