import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FlightCancellationController } from './flight-cancellation.controller';
import type { FlightCancellationService } from './flight-cancellation.service';

describe('FlightCancellationController (FLT-06)', () => {
  it('passes the flight id and the moderator to the cancellation', async () => {
    const cancellations = {
      cancelFlight: jest.fn().mockResolvedValue({ cancelledBookings: 1 }),
    };
    const controller = new FlightCancellationController(
      cancellations as unknown as FlightCancellationService,
    );

    await expect(controller.cancel('flight-1', 'moderator-1')).resolves.toEqual(
      { cancelledBookings: 1 },
    );
    expect(cancellations.cancelFlight).toHaveBeenCalledWith(
      'flight-1',
      'moderator-1',
    );
  });

  it('is POST /flights/:id/cancel, 200, for airline moderators only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = FlightCancellationController.prototype.cancel;

    expect(
      Reflect.getMetadata(PATH_METADATA, FlightCancellationController),
    ).toBe('flights');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/cancel');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
      HttpStatus.OK,
    );
    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.AirlineModerator]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightCancellationController,
      ]),
    ).toBeUndefined();
  });
});
