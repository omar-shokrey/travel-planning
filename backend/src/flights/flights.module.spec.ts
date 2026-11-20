import { RequestMethod, type Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { FlightDetailsController } from './flight-details.controller';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightsModule } from './flights.module';

/** The GET routes of a controller, as `<controller path>/<route path>`. */
function getRoutesOf(controller: Type<unknown>): string[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .map((name) => prototype[name])
    .filter(
      (handler): handler is object =>
        typeof handler === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.GET,
    )
    .map(
      (handler) =>
        `${base}/${String(Reflect.getMetadata(PATH_METADATA, handler))}`,
    );
}

describe('FlightsModule', () => {
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    FlightsModule,
  ) as Type<unknown>[];

  it('registers GET /flights/search before any GET /flights/:id route (FLT-11, FLT-17)', () => {
    const searchIndex = controllers.findIndex((controller) =>
      getRoutesOf(controller).includes('flights/search'),
    );
    const idIndexes = controllers
      .map((controller, index) => ({ index, routes: getRoutesOf(controller) }))
      .filter(({ routes }) =>
        routes.some((route) => route.startsWith('flights/:')),
      )
      .map(({ index }) => index);

    expect(controllers[searchIndex]).toBe(FlightSearchController);
    for (const index of idIndexes) {
      expect(searchIndex).toBeLessThan(index);
    }
  });

  it('registers GET /flights/:id (FLT-17) in a controller after the search', () => {
    const detailsIndex = controllers.indexOf(FlightDetailsController);

    expect(getRoutesOf(FlightDetailsController)).toEqual(['flights/:id']);
    expect(detailsIndex).toBeGreaterThan(
      controllers.indexOf(FlightSearchController),
    );
  });

  it('puts the search controller first among the controllers of /flights', () => {
    const flightsControllers = controllers.filter(
      (controller) =>
        Reflect.getMetadata(PATH_METADATA, controller) === 'flights',
    );

    expect(flightsControllers[0]).toBe(FlightSearchController);
  });

  it('reads the GET routes of a controller (a check that the order test can see a :id route)', () => {
    class Example {
      find(): void {}
    }
    Reflect.defineMetadata(PATH_METADATA, 'flights', Example);
    Reflect.defineMetadata(PATH_METADATA, ':id', Example.prototype.find);
    Reflect.defineMetadata(
      METHOD_METADATA,
      RequestMethod.GET,
      Example.prototype.find,
    );

    expect(getRoutesOf(Example)).toEqual(['flights/:id']);
  });

  it('exports FlightSearchService, for the flights of an itinerary (ITN-26)', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, FlightsModule),
    ).toContain(FlightSearchService);
  });
});
