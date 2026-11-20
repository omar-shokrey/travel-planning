import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
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
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';
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
    // ExchangeRatesService: the budget summary in the user's currency (ITN-18).
    ExchangeRatesModule,
    // UploadsService: activity images (ITN-12, GEN-08).
    UploadsModule,
    // HotelSearchService: the hotels of a city group (ITN-25, HTL-11).
    HotelsModule,
    // FlightSearchService: the flights to the first city (ITN-26, FLT-11, FLT-12).
    FlightsModule,
  ],
  // ItineraryHotelsController and ItineraryFlightsController are after
  // PublicItinerariesController, so the routes under /itineraries/public/
  // are matched first, as before ITN-25.
  controllers: [
    ItinerariesController,
    ActivitiesController,
    BudgetsController,
    TransportCostsController,
    PublicItinerariesController,
    ItineraryHotelsController,
    ItineraryFlightsController,
  ],
  providers: [
    ItinerariesService,
    ActivitiesService,
    ActivityImagesService,
    BudgetsService,
    TransportCostsService,
    PublicItinerariesService,
    ItineraryHotelsService,
    ItineraryFlightsService,
  ],
  // PublicItinerariesService: the public author page of the blog (BLG-12).
  exports: [ItinerariesService, PublicItinerariesService],
})
export class ItinerariesModule {}
