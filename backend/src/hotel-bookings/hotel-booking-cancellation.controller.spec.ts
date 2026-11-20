import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { HotelBookingCancellationController } from './hotel-booking-cancellation.controller';
import type { HotelBookingCancellationService } from './hotel-booking-cancellation.service';

describe('HotelBookingCancellationController (HTL-21)', () => {
  const setup = () => {
    const service = {
      preview: jest.fn().mockResolvedValue({ refundPercent: 50 }),
      cancel: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    };
    const controller = new HotelBookingCancellationController(
      service as unknown as HotelBookingCancellationService,
    );
    return { service, controller };
  };

  it('passes the id and the logged-in user to the preview', async () => {
    const { service, controller } = setup();

    await expect(
      controller.cancellationPreview('b1', 'user-1'),
    ).resolves.toEqual({ refundPercent: 50 });
    expect(service.preview).toHaveBeenCalledWith('b1', 'user-1');
  });

  it('passes the confirmed percent to the cancellation', async () => {
    const { service, controller } = setup();

    await expect(
      controller.cancel('b1', { expectedRefundPercent: 50 }, 'user-1'),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(service.cancel).toHaveBeenCalledWith('b1', 'user-1', 50);
  });

  it.each(['cancellationPreview', 'cancel'] as const)(
    '%s is for registered users only, needs a login, and is at :id/cancel',
    (name) => {
      const handler = HotelBookingCancellationController.prototype[name];
      const reflector = new Reflector();

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          HotelBookingCancellationController,
        ]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/cancel');
    },
  );

  it('answers the cancellation with 200, not 201', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HotelBookingCancellationController.prototype.cancel,
      ),
    ).toBe(HttpStatus.OK);
  });
});
