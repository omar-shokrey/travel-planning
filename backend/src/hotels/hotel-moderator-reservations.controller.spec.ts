import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { ModeratorReservationsQueryDto } from './dto/moderator-reservations-query.dto';
import { HotelModeratorReservationsController } from './hotel-moderator-reservations.controller';
import type { HotelModeratorReservationsService } from './hotel-moderator-reservations.service';

describe('HotelModeratorReservationsController (HTL-22)', () => {
  it('passes the hotel id, the query and the logged-in moderator to the service', async () => {
    const service = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new HotelModeratorReservationsController(
      service as unknown as HotelModeratorReservationsService,
    );
    const query = { page: 1, limit: 10 } as ModeratorReservationsQueryDto;

    await expect(controller.list('h1', query, 'mod-1')).resolves.toEqual({
      items: [],
    });
    expect(service.list).toHaveBeenCalledWith('h1', query, 'mod-1');
  });

  it('is GET :id/reservations for hotel moderators only, and needs a login', () => {
    const handler = HotelModeratorReservationsController.prototype.list;
    const reflector = new Reflector();

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.HotelModerator]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        HotelModeratorReservationsController,
      ]),
    ).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':id/reservations',
    );
  });
});
