import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PaginationMeta } from '../common/dto/paginated-response.dto';
import { FlightSearchResultResponseDto } from './dto/flight-search-result-response.dto';
import type { SearchFlightsQueryDto } from './dto/search-flights-query.dto';
import { FlightSearchController } from './flight-search.controller';
import { FlightsController } from './flights.controller';
import type { FlightSearchService } from './flight-search.service';

/** The keys @nestjs/swagger stores its decorators under. */
const API_RESPONSE = 'swagger/apiResponse';
const API_EXTRA_MODELS = 'swagger/apiExtraModels';
const API_SECURITY = 'swagger/apiSecurity';

describe('FlightSearchController (FLT-11)', () => {
  const handler = FlightSearchController.prototype.search;

  it('gives the query to the service and returns its page', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { search: jest.fn().mockResolvedValue(page) };
    const controller = new FlightSearchController(
      service as unknown as FlightSearchService,
    );
    const query = { departureAirport: 'CAI' } as SearchFlightsQueryDto;

    await expect(controller.search(query)).resolves.toBe(page);
    expect(service.search).toHaveBeenCalledWith(query);
  });

  it('is open to guests and users: public, with no role', () => {
    const reflector = new Reflector();

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    // No lock in Swagger. The key is the right one: the create route has it.
    expect(Reflect.getMetadata(API_SECURITY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(API_SECURITY, FlightsController.prototype.create),
    ).toEqual([{ cookie: [] }]);
  });

  it('documents a paginated list of search results', () => {
    const responses = Reflect.getMetadata(API_RESPONSE, handler) as Record<
      string,
      { schema: { properties: { items: { items: { $ref: string } } } } }
    >;
    const models = Reflect.getMetadata(API_EXTRA_MODELS, handler) as unknown[];

    expect(responses['200'].schema.properties.items.items.$ref).toBe(
      '#/components/schemas/FlightSearchResultResponseDto',
    );
    expect(models).toEqual(
      expect.arrayContaining([PaginationMeta, FlightSearchResultResponseDto]),
    );
    expect(responses['400']).toBeDefined();
  });
});
