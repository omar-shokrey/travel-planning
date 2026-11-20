import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { ReservationGroup } from './enums/reservation-group.enum';
import { HotelReservationsController } from './hotel-reservations.controller';
import type { HotelReservationsService } from './hotel-reservations.service';

describe('HotelReservationsController (HTL-20)', () => {
  const setup = () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      findOne: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    const controller = new HotelReservationsController(
      service as unknown as HotelReservationsService,
    );
    return { service, controller };
  };

  it('passes the logged-in user and the query to the list', async () => {
    const { service, controller } = setup();
    const query = { group: ReservationGroup.Past } as HotelReservationsQueryDto;

    await expect(controller.list('user-1', query)).resolves.toEqual({
      items: [],
    });
    expect(service.list).toHaveBeenCalledWith('user-1', query);
  });

  it('passes the id and the logged-in user to the details', async () => {
    const { service, controller } = setup();

    await expect(controller.findOne('r1', 'user-1')).resolves.toEqual({
      id: 'r1',
    });
    expect(service.findOne).toHaveBeenCalledWith('r1', 'user-1');
  });

  it.each([
    ['list', '/'],
    ['findOne', ':id'],
  ] as const)(
    '%s is for registered users only, needs a login, and is at %s',
    (name, path) => {
      const handler = HotelReservationsController.prototype[name];
      const reflector = new Reflector();

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          HotelReservationsController,
        ]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );
});
