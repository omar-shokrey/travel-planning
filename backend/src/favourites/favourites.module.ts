import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';
import { Favourite, FavouriteSchema } from './models/favourite.schema';

/**
 * BON-02: the favourites of registered users. It reads the hotels' and the
 * public itineraries' cards through the services those modules export
 * (`HotelsService`, `PublicItinerariesService`). Neither imports this module,
 * so there is no cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Favourite.name, schema: FavouriteSchema },
    ]),
    HotelsModule,
    ItinerariesModule,
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
