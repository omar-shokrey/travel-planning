import type { Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { HotelsModule } from '../hotels/hotels.module';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItinerariesModule } from './itineraries.module';
import { PublicItinerariesController } from './public-itineraries.controller';

const metadata = <T>(key: string): T[] =>
  Reflect.getMetadata(key, ItinerariesModule) as T[];

describe('ItinerariesModule', () => {
  it('imports the hotels module, for the hotels of a city group (ITN-25)', () => {
    expect(metadata<unknown>(MODULE_METADATA.IMPORTS)).toContain(HotelsModule);
  });

  it('provides the hotels service and registers its controller', () => {
    expect(metadata<unknown>(MODULE_METADATA.PROVIDERS)).toContain(
      ItineraryHotelsService,
    );
    expect(metadata<unknown>(MODULE_METADATA.CONTROLLERS)).toContain(
      ItineraryHotelsController,
    );
  });

  it('registers the hotels of a city group after the public itineraries, so /itineraries/public/... is matched first', () => {
    const controllers = metadata<Type>(MODULE_METADATA.CONTROLLERS);

    expect(controllers.indexOf(ItineraryHotelsController)).toBeGreaterThan(
      controllers.indexOf(PublicItinerariesController),
    );
  });
});
