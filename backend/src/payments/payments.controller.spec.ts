import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { BookingType } from './enums/booking-type.enum';
import { PaymentsController } from './payments.controller';
import type { PaymentsService } from './payments.service';

describe('PaymentsController (PAY-01)', () => {
  const id = '6740f1c2a4b5c6d7e8f90abc';

  const setup = () => {
    const answer = { id };
    const service = {
      start: jest.fn().mockResolvedValue(answer),
      retry: jest.fn().mockResolvedValue(answer),
      findOne: jest.fn().mockResolvedValue(answer),
    };
    const controller = new PaymentsController(
      service as unknown as PaymentsService,
    );
    return { answer, service, controller };
  };

  it('passes the body and the logged-in user to start', async () => {
    const { answer, service, controller } = setup();
    const dto = {
      bookingType: BookingType.Hotel,
      bookingId: '6740f1c2a4b5c6d7e8f90789',
    };

    await expect(controller.start(dto, 'user-1')).resolves.toBe(answer);
    expect(service.start).toHaveBeenCalledWith('user-1', dto);
  });

  it('passes the id and the logged-in user to retry', async () => {
    const { answer, service, controller } = setup();

    await expect(controller.retry(id, 'user-1')).resolves.toBe(answer);
    expect(service.retry).toHaveBeenCalledWith(id, 'user-1');
  });

  it('passes the id and the logged-in user to findOne', async () => {
    const { answer, service, controller } = setup();

    await expect(controller.findOne(id, 'user-1')).resolves.toBe(answer);
    expect(service.findOne).toHaveBeenCalledWith(id, 'user-1');
  });

  it.each(['start', 'retry', 'findOne'] as const)(
    '%s is for registered users only, and needs a login',
    (name) => {
      const reflector = new Reflector();
      const handler = PaymentsController.prototype[name];

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          PaymentsController,
        ]),
      ).toBeUndefined();
    },
  );

  it('answers 200 to a retry, which creates nothing', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        PaymentsController.prototype.retry,
      ),
    ).toBe(HttpStatus.OK);
  });
});
