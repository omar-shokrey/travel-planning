import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import type { ItineraryHotelResponseDto } from './dto/itinerary-hotel-response.dto';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import type { ItineraryHotelsService } from './itinerary-hotels.service';

describe('ItineraryHotelsController (ITN-25)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const itineraryId = '6740f1c2a4b5c6d7e8f90789';
  const page = {
    items: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
  } as PaginatedResponse<ItineraryHotelResponseDto>;

  function setup() {
    const itineraryHotels = { search: jest.fn().mockResolvedValue(page) };
    const controller = new ItineraryHotelsController(
      itineraryHotels as unknown as ItineraryHotelsService,
    );
    return { itineraryHotels, controller };
  }

  it('gives the service the itinerary id, the query and the logged-in user, and returns its answer', async () => {
    const { itineraryHotels, controller } = setup();
    const query = Object.assign(new ItineraryHotelsQueryDto(), {
      firstDayNumber: 2,
      guests: 2,
    });

    expect(await controller.search(itineraryId, query, userId)).toBe(page);
    expect(itineraryHotels.search).toHaveBeenCalledWith(
      itineraryId,
      query,
      userId,
    );
  });

  it('is for registered users only', () => {
    const reflector = new Reflector();
    const handler = ItineraryHotelsController.prototype.search;

    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        ItineraryHotelsController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [
        handler,
        ItineraryHotelsController,
      ]),
    ).toEqual([Role.User]);
  });
});
