import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { BookingPoliciesController } from './booking-policies.controller';
import type { BookingPoliciesService } from './booking-policies.service';
import { BookingType } from './enums/booking-type.enum';

describe('BookingPoliciesController (PAY-02)', () => {
  const id = '6740f1c2a4b5c6d7e8f90789';

  const setup = () => {
    const answer = { bookingId: id };
    const service = {
      findPolicies: jest.fn().mockResolvedValue(answer),
      acceptPolicies: jest.fn().mockResolvedValue(answer),
    };
    const controller = new BookingPoliciesController(
      service as unknown as BookingPoliciesService,
    );
    return { answer, service, controller };
  };

  it('passes the type, the id and the logged-in user to findPolicies', async () => {
    const { answer, service, controller } = setup();

    await expect(
      controller.findPolicies({ type: BookingType.Hotel, id }, 'user-1'),
    ).resolves.toBe(answer);
    expect(service.findPolicies).toHaveBeenCalledWith(
      BookingType.Hotel,
      id,
      'user-1',
    );
  });

  it('passes the type, the id and the logged-in user to acceptPolicies', async () => {
    const { answer, service, controller } = setup();

    await expect(
      controller.acceptPolicies(
        { type: BookingType.Flight, id },
        { accepted: true },
        'user-1',
      ),
    ).resolves.toBe(answer);
    expect(service.acceptPolicies).toHaveBeenCalledWith(
      BookingType.Flight,
      id,
      'user-1',
    );
  });

  it.each(['findPolicies', 'acceptPolicies'] as const)(
    '%s is for registered users only, and needs a login',
    (name) => {
      const reflector = new Reflector();
      const handler = BookingPoliciesController.prototype[name];

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          BookingPoliciesController,
        ]),
      ).toBeUndefined();
    },
  );

  it('answers 200, not 201, to an acceptance', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        BookingPoliciesController.prototype.acceptPolicies,
      ),
    ).toBe(HttpStatus.OK);
  });
});
