import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { HotelAvailableRoomsController } from './hotel-available-rooms.controller';
import type { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { HotelSearchController } from './hotel-search.controller';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
/**
 * The metadata keys @nestjs/swagger writes for @ApiTags and @ApiSecurity
 * (`DECORATORS` in its constants, which the package does not export).
 */
const API_TAGS = 'swagger/apiUseTags';
const API_SECURITY = 'swagger/apiSecurity';
const handler = HotelAvailableRoomsController.prototype.findAvailable;

describe('HotelAvailableRoomsController (HTL-15)', () => {
  it('passes the hotel id and the stay to the service and returns its page', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { findAvailable: jest.fn().mockResolvedValue(page) };
    const controller = new HotelAvailableRoomsController(
      service as unknown as HotelAvailableRoomsService,
    );
    const query = {
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      page: 1,
      limit: 10,
    } as AvailableRoomsQueryDto;

    expect(await controller.findAvailable(HOTEL_ID, query)).toBe(page);
    expect(service.findAvailable).toHaveBeenCalledWith(HOTEL_ID, query);
  });

  it('is GET /hotels/:id/rooms/available, as in the endpoint table', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, HotelAvailableRoomsController),
    ).toBe('hotels');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':id/rooms/available',
    );
  });

  it('is open to guests and to every role', () => {
    const reflector = new Reflector();

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(
      reflector.get(ROLES_KEY, HotelAvailableRoomsController),
    ).toBeUndefined();
  });

  it('checks the hotel id with ParseObjectIdPipe', () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      HotelAvailableRoomsController,
      'findAvailable',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const idArgument = Object.values(args).find((arg) => arg.data === 'id');

    expect(idArgument?.pipes).toContain(ParseObjectIdPipe);
  });

  it('is in the same Swagger group as the other hotel routes, with no lock', () => {
    expect(
      Reflect.getMetadata(API_TAGS, HotelAvailableRoomsController),
    ).toEqual(Reflect.getMetadata(API_TAGS, HotelSearchController));
    expect(
      Reflect.getMetadata(API_TAGS, HotelAvailableRoomsController),
    ).toEqual(['hotels']);
    expect(Reflect.getMetadata(API_SECURITY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(API_SECURITY, HotelAvailableRoomsController),
    ).toBeUndefined();
  });
});
