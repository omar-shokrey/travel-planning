import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RefundsController } from './refunds.controller';
import type { RefundsService } from './refunds.service';

describe('RefundsController (PAY-03)', () => {
  const id = '6740f1c2a4b5c6d7e8f90aaa';

  it("passes the id and the logged-in user, and returns the owner's refund", async () => {
    const answer = { id };
    const service = { findOwned: jest.fn().mockResolvedValue(answer) };
    const controller = new RefundsController(
      service as unknown as RefundsService,
    );

    await expect(controller.findOne(id, 'user-1')).resolves.toBe(answer);
    expect(service.findOwned).toHaveBeenCalledWith(id, 'user-1');
  });

  it("answers 404 for someone else's refund, as the service decides", async () => {
    const service = {
      findOwned: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Refund not found')),
    };
    const controller = new RefundsController(
      service as unknown as RefundsService,
    );

    await expect(controller.findOne(id, 'stranger')).rejects.toThrow(
      new NotFoundException('Refund not found'),
    );
  });

  it('is for registered users only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = RefundsController.prototype.findOne;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, RefundsController]),
    ).toBeUndefined();
  });

  it('has no route that creates a refund', () => {
    const methods = Object.getOwnPropertyNames(
      RefundsController.prototype,
    ).filter((name) => name !== 'constructor');

    expect(methods).toEqual(['findOne']);
  });
});
