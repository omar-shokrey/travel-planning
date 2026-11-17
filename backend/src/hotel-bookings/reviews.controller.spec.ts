import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { ReviewsController } from './reviews.controller';
import type { ReviewsService } from './reviews.service';

const setup = () => {
  const review = { id: 'r1', rating: 5 };
  const service = {
    create: jest.fn().mockResolvedValue(review),
    update: jest.fn().mockResolvedValue(review),
    remove: jest.fn().mockResolvedValue(undefined),
    findForHotel: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  };
  const controller = new ReviewsController(
    service as unknown as ReviewsService,
  );
  return { controller, service, review };
};

describe('ReviewsController (HTL-23)', () => {
  it('reviews a reservation for the logged-in user', async () => {
    const { controller, service, review } = setup();

    expect(await controller.create('b1', { rating: 5 }, 'u1')).toBe(review);
    expect(service.create).toHaveBeenCalledWith('b1', 'u1', { rating: 5 });
  });

  it('edits and deletes a review for the logged-in user', async () => {
    const { controller, service, review } = setup();

    expect(await controller.update('r1', { rating: 3 }, 'u1')).toBe(review);
    expect(service.update).toHaveBeenCalledWith('r1', 'u1', { rating: 3 });
    await controller.remove('r1', 'u1');
    expect(service.remove).toHaveBeenCalledWith('r1', 'u1');
  });

  it.each(['create', 'update', 'remove'] as const)(
    '%s is open to registered users only',
    (method) => {
      expect(
        Reflect.getMetadata(ROLES_KEY, ReviewsController.prototype[method]),
      ).toEqual([Role.User]);
    },
  );

  it('lists the reviews of a hotel for everyone (HTL-24)', async () => {
    const { controller, service } = setup();
    const query = { page: 1, limit: 10 } as PaginationQueryDto;

    expect(await controller.findForHotel('h1', query)).toEqual({
      items: [],
      meta: {},
    });
    expect(service.findForHotel).toHaveBeenCalledWith('h1', query);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        ReviewsController.prototype.findForHotel,
      ),
    ).toBe(true);
  });

  it('answers 204 to a delete', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ReviewsController.prototype.remove,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
  });
});
