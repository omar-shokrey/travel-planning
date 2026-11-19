import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import type { ItineraryFlightsResponseDto } from './dto/itinerary-flights-response.dto';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import type { ItineraryFlightsService } from './itinerary-flights.service';

const API_RESPONSE = 'swagger/apiResponse';

describe('ItineraryFlightsController (ITN-26)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const itineraryId = '6740f1c2a4b5c6d7e8f90789';
  const answer = { outbound: {}, return: null } as ItineraryFlightsResponseDto;
  const handler = ItineraryFlightsController.prototype.search;

  it('gives the service the itinerary id, the query and the logged-in user, and returns its answer', async () => {
    const itineraryFlights = { search: jest.fn().mockResolvedValue(answer) };
    const controller = new ItineraryFlightsController(
      itineraryFlights as unknown as ItineraryFlightsService,
    );
    const query = Object.assign(new ItineraryFlightsQueryDto(), {
      originAirport: 'CAI',
      passengers: 1,
    });

    expect(await controller.search(itineraryId, query, userId)).toBe(answer);
    expect(itineraryFlights.search).toHaveBeenCalledWith(
      itineraryId,
      query,
      userId,
    );
  });

  it('is for registered users only', () => {
    const reflector = new Reflector();

    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        ItineraryFlightsController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [
        handler,
        ItineraryFlightsController,
      ]),
    ).toEqual([Role.User]);
  });

  it('documents the answer and every refusal in Swagger', () => {
    const responses = Reflect.getMetadata(API_RESPONSE, handler) as Record<
      string,
      { type?: unknown }
    >;

    expect(responses['200'].type).toBeDefined();
    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(['200', '400', '403', '404']),
    );
  });
});
