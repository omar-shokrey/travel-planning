import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FavouriteTargetType } from './enums/favourite-target-type.enum';
import { FavouritesController } from './favourites.controller';
import type { FavouritesService } from './favourites.service';

function setup(created: boolean) {
  const service = {
    add: jest.fn().mockResolvedValue({ favourite: { id: 'f1' }, created }),
    list: jest.fn().mockResolvedValue({ items: [], meta: {} }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const response = { status: jest.fn() };
  const controller = new FavouritesController(
    service as unknown as FavouritesService,
  );
  return { service, response, controller };
}

const body = { targetType: FavouriteTargetType.Hotel, targetId: 'h1' };

describe('FavouritesController (BON-02)', () => {
  it('answers 201 for a new favourite and returns it', async () => {
    const { service, response, controller } = setup(true);

    await expect(
      controller.add(body, 'u1', response as unknown as Response),
    ).resolves.toEqual({ id: 'f1' });
    expect(service.add).toHaveBeenCalledWith('u1', body);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });

  it('answers 200 for a target saved already', async () => {
    const { response, controller } = setup(false);

    await controller.add(body, 'u1', response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('passes the query and the user to list, and the id and the user to remove', async () => {
    const { service, controller } = setup(true);
    const query = { page: 1, limit: 10 } as never;

    await controller.list(query, 'u1');
    await controller.remove('f1', 'u1');

    expect(service.list).toHaveBeenCalledWith('u1', query);
    expect(service.remove).toHaveBeenCalledWith('f1', 'u1');
  });

  it.each(['add', 'list', 'remove'] as const)(
    '%s is for registered users only and needs a login',
    (name) => {
      const handler = FavouritesController.prototype[name];
      const reflector = new Reflector();

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          FavouritesController,
        ]),
      ).toBeUndefined();
    },
  );

  it('lives under /favourites and answers a removal with 204', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FavouritesController)).toBe(
      'favourites',
    );
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        FavouritesController.prototype.remove,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
  });
});
