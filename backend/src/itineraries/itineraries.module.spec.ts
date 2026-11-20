import type { Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { ItineraryBookingsController } from './itinerary-bookings.controller';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';
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

  it('imports the flights module and provides the flights of an itinerary (ITN-26)', () => {
    expect(metadata<unknown>(MODULE_METADATA.IMPORTS)).toContain(FlightsModule);
    expect(metadata<unknown>(MODULE_METADATA.PROVIDERS)).toContain(
      ItineraryFlightsService,
    );
    expect(metadata<unknown>(MODULE_METADATA.CONTROLLERS)).toContain(
      ItineraryFlightsController,
    );
  });

  it('registers the flights of an itinerary after the public itineraries, so /itineraries/public/... is matched first', () => {
    const controllers = metadata<Type>(MODULE_METADATA.CONTROLLERS);

    expect(controllers.indexOf(ItineraryFlightsController)).toBeGreaterThan(
      controllers.indexOf(PublicItinerariesController),
    );
  });

  it('imports both booking modules and provides the bookings of an itinerary (ITN-27)', () => {
    const imports = metadata<unknown>(MODULE_METADATA.IMPORTS);

    expect(imports).toContain(FlightBookingsModule);
    expect(imports).toContain(HotelBookingsModule);
    expect(metadata<unknown>(MODULE_METADATA.PROVIDERS)).toContain(
      ItineraryBookingsService,
    );
    expect(metadata<unknown>(MODULE_METADATA.CONTROLLERS)).toContain(
      ItineraryBookingsController,
    );
  });

  it('registers the bookings of an itinerary after the public itineraries, so /itineraries/public/... is matched first', () => {
    const controllers = metadata<Type>(MODULE_METADATA.CONTROLLERS);

    expect(controllers.indexOf(ItineraryBookingsController)).toBeGreaterThan(
      controllers.indexOf(PublicItinerariesController),
    );
  });
});
