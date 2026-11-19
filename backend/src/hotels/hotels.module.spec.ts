import { RequestMethod, type Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { HotelAvailableRoomsController } from './hotel-available-rooms.controller';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { HotelDetailsController } from './hotel-details.controller';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelsModule } from './hotels.module';
import { HotelsService } from './hotels.service';

const controllers = Reflect.getMetadata(
  MODULE_METADATA.CONTROLLERS,
  HotelsModule,
) as Type[];

interface GetRoute {
  controller: Type;
  path: string;
}

/**
 * Every GET route of the module, in the order Nest registers them: controller
 * by controller as listed in the module, then method by method. Express
 * answers a request with the first route whose path matches it.
 */
const getRoutes = (): GetRoute[] =>
  controllers.flatMap((controller) => {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .map((name) => prototype[name])
      .filter(
        (method) =>
          typeof method === 'function' &&
          Reflect.getMetadata(METHOD_METADATA, method) === RequestMethod.GET,
      )
      .map((method) => ({
        controller,
        path: `${base}/${Reflect.getMetadata(PATH_METADATA, method as object) as string}`,
      }));
  });

/** The route that answers `url` first, as Express would pick it. */
const firstMatch = (url: string): GetRoute | undefined =>
  getRoutes().find(({ path }) =>
    new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`).test(url),
  );

describe('HotelsModule', () => {
  it('keeps HotelDetailsController (GET /hotels/:id) last', () => {
    expect(controllers[controllers.length - 1]).toBe(HotelDetailsController);
  });

  it('registers search before the hotel page: the one path that depends on the order', () => {
    const details = controllers.indexOf(HotelDetailsController);

    expect(controllers.indexOf(HotelSearchController)).toBeGreaterThanOrEqual(
      0,
    );
    expect(controllers.indexOf(HotelSearchController)).toBeLessThan(details);
    expect(firstMatch('hotels/search')?.controller).toBe(HotelSearchController);
  });

  it('registers the available rooms', () => {
    expect(controllers).toContain(HotelAvailableRoomsController);
  });

  it('sends each GET path to the route that owns it', () => {
    const id = '6740f1c2a4b5c6d7e8f90123';

    expect(firstMatch(`hotels/${id}/rooms/available`)?.controller).toBe(
      HotelAvailableRoomsController,
    );
    expect(firstMatch(`hotels/${id}/availability`)?.path).toBe(
      'hotels/:id/availability',
    );
    expect(firstMatch(`hotels/${id}`)?.controller).toBe(HotelDetailsController);
  });

  it('never lets GET /hotels/:id answer a longer path, whatever the order', () => {
    const id = '6740f1c2a4b5c6d7e8f90123';
    const details = getRoutes().filter(
      (route) => route.controller === HotelDetailsController,
    );

    expect(details.map((route) => route.path)).toEqual(['hotels/:id']);
    for (const url of [
      `hotels/${id}/rooms/available`,
      `hotels/${id}/availability`,
    ]) {
      const pattern = new RegExp(
        `^${details[0].path.replace(/:[^/]+/g, '[^/]+')}$`,
      );
      expect(pattern.test(url)).toBe(false);
    }
  });

  it('provides the available-rooms service, and exports only what other modules need', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, HotelsModule),
    ).toContain(HotelAvailableRoomsService);
    // HotelSearchService is for the itineraries module (ITN-25); the
    // available-rooms service stays private to the hotels module.
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, HotelsModule)).toEqual([
      HotelsService,
      HotelSearchService,
    ]);
  });
});
