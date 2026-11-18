import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type {
  PublicItineraryDetailResponseDto,
  PublicItineraryResponseDto,
} from './dto/public-itinerary-response.dto';
import { SearchPublicItinerariesQueryDto } from './dto/search-public-itineraries-query.dto';
import { PublicItinerariesController } from './public-itineraries.controller';
import type { PublicItinerariesService } from './public-itineraries.service';

describe('PublicItinerariesController', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const itineraryId = '6740f1c2a4b5c6d7e8f90456';
  const page = {
    items: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
  } as PaginatedResponse<PublicItineraryResponseDto>;
  const publicItinerary = {
    id: itineraryId,
  } as PublicItineraryDetailResponseDto;
  const clone = {
    id: '6740f1c2a4b5c6d7e8f90789',
  } as ItineraryDetailResponseDto;

  function setup() {
    const publicItinerariesService = {
      search: jest.fn().mockResolvedValue(page),
      findPublic: jest.fn().mockResolvedValue(publicItinerary),
      clone: jest.fn().mockResolvedValue(clone),
    };
    const controller = new PublicItinerariesController(
      publicItinerariesService as unknown as PublicItinerariesService,
    );
    return { publicItinerariesService, controller };
  }

  const reflector = new Reflector();

  describe('search (ITN-21)', () => {
    it('gives the service the query and returns its answer', async () => {
      const { publicItinerariesService, controller } = setup();
      const query = Object.assign(new SearchPublicItinerariesQueryDto(), {
        q: 'Cairo',
        minDays: 3,
        maxDays: 10,
        country: 'EG',
        city: 'cairo',
      });

      expect(await controller.search(query)).toBe(page);
      expect(publicItinerariesService.search).toHaveBeenCalledWith(query);
    });

    it('is open to guests', () => {
      const handler = PublicItinerariesController.prototype.search;

      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    });
  });

  describe('findPublic (ITN-21)', () => {
    it('gives the service the itinerary id and returns its answer', async () => {
      const { publicItinerariesService, controller } = setup();

      expect(await controller.findPublic(itineraryId)).toBe(publicItinerary);
      expect(publicItinerariesService.findPublic).toHaveBeenCalledWith(
        itineraryId,
      );
    });

    it('is open to guests', () => {
      const handler = PublicItinerariesController.prototype.findPublic;

      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    });
  });

  describe('clone (ITN-21)', () => {
    it('gives the service the itinerary id and the logged-in user, and returns its answer', async () => {
      const { publicItinerariesService, controller } = setup();

      expect(await controller.clone(itineraryId, userId)).toBe(clone);
      expect(publicItinerariesService.clone).toHaveBeenCalledWith(
        itineraryId,
        userId,
      );
    });

    it('is for registered users only', () => {
      const handler = PublicItinerariesController.prototype.clone;

      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    });
  });

  it('is not public or role-restricted as a whole, so only the two read routes are open', () => {
    expect(
      reflector.get(IS_PUBLIC_KEY, PublicItinerariesController),
    ).toBeUndefined();
    expect(
      reflector.get(ROLES_KEY, PublicItinerariesController),
    ).toBeUndefined();
  });
});
