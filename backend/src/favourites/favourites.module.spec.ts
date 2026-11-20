import { MODULE_METADATA } from '@nestjs/common/constants';
import { HotelsModule } from '../hotels/hotels.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { FavouritesController } from './favourites.controller';
import { FavouritesModule } from './favourites.module';
import { FavouritesService } from './favourites.service';

describe('FavouritesModule (BON-02)', () => {
  it('has the favourites controller and service, and exports nothing', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FavouritesModule),
    ).toEqual([FavouritesController]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FavouritesModule),
    ).toEqual([FavouritesService]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, FavouritesModule),
    ).toBeUndefined();
  });

  it('reads the hotels and the public itineraries through their modules', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, FavouritesModule),
    ).toEqual(expect.arrayContaining([HotelsModule, ItinerariesModule]));
  });
});
