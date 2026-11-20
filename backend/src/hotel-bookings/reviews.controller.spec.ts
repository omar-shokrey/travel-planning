import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  HotelReviewsController,
  ReviewsController,
} from './reviews.controller';
import type { ReviewsService } from './reviews.service';

describe('Review controllers (HTL-23)', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'r1' }),
    update: jest.fn().mockResolvedValue({ id: 'r1', rating: 2 }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const reviews = service as unknown as ReviewsService;

  it('passes the reservation, the body and the logged-in user to create', async () => {
    await expect(
      new HotelReviewsController(reviews).create('b1', { rating: 4 }, 'u1'),
    ).resolves.toEqual({ id: 'r1' });
    expect(service.create).toHaveBeenCalledWith('b1', 'u1', { rating: 4 });
  });

  it('passes the review, the body and the logged-in user to update and remove', async () => {
    const controller = new ReviewsController(reviews);

    await controller.update('r1', { rating: 2 }, 'u1');
    await controller.remove('r1', 'u1');

    expect(service.update).toHaveBeenCalledWith('r1', 'u1', { rating: 2 });
    expect(service.remove).toHaveBeenCalledWith('r1', 'u1');
  });

  it.each([
    [HotelReviewsController, 'create', ':id/review'],
    [ReviewsController, 'update', ':id'],
    [ReviewsController, 'remove', ':id'],
  ] as const)(
    '%p.%s is for registered users only, needs a login, and is at %s',
    (controller, name, path) => {
      const handler = (
        controller.prototype as unknown as Record<string, () => unknown>
      )[name];
      const reflector = new Reflector();

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, controller]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );

  it('answers a deletion with 204 and lives under /reviews', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ReviewsController.prototype.remove,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
    expect(Reflect.getMetadata(PATH_METADATA, ReviewsController)).toBe(
      'reviews',
    );
    expect(Reflect.getMetadata(PATH_METADATA, HotelReviewsController)).toBe(
      'hotel-bookings',
    );
  });
});
