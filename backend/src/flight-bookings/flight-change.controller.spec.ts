import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { ChangeFlightDto } from './dto/change-flight.dto';
import { FlightChangeController } from './flight-change.controller';
import type { FlightChangeService } from './flight-change.service';

describe('FlightChangeController (FLT-27)', () => {
  it('passes the booking, the logged-in user and the body to the service and returns its answer', async () => {
    const changes = {
      change: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ id: null, status: 'quote' }),
      ),
    };
    const controller = new FlightChangeController(
      changes as unknown as FlightChangeService,
    );
    const body = { newFlightId: 'f2', dryRun: true } as ChangeFlightDto;

    await expect(controller.change('b1', body, 'u1')).resolves.toEqual({
      id: null,
      status: 'quote',
    });
    expect(changes.change).toHaveBeenCalledWith('b1', 'u1', body);
  });

  it('is PATCH :id/change-flight, for registered users only, and needs a login', () => {
    const handler = FlightChangeController.prototype.change;
    const reflector = new Reflector();

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightChangeController,
      ]),
    ).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':id/change-flight',
    );
    expect(Reflect.getMetadata(PATH_METADATA, FlightChangeController)).toBe(
      'flight-bookings',
    );
  });
});
