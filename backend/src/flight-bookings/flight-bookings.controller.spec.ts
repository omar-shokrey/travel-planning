import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightBookingsController } from './flight-bookings.controller';
import type { FlightBookingsService } from './flight-bookings.service';

describe('FlightBookingsController (FLT-22, FLT-19)', () => {
  it('passes the logged-in user and the body to hold and returns its answer', async () => {
    const answer = { id: 'booking-1' };
    const service = { hold: jest.fn().mockResolvedValue(answer) };
    const controller = new FlightBookingsController(
      service as unknown as FlightBookingsService,
    );
    const dto = {
      flightId: '6740f1c2a4b5c6d7e8f90456',
      cabin: CabinClass.Economy,
      passengers: [
        {
          fullName: 'Sara Ahmed',
          dateOfBirth: '1990-05-14',
          passportNumber: 'A12345678',
        },
      ],
    };

    await expect(controller.hold(dto, 'user-1')).resolves.toBe(answer);
    expect(service.hold).toHaveBeenCalledWith('user-1', dto);
  });

  it('is for registered users only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = FlightBookingsController.prototype.hold;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightBookingsController,
      ]),
    ).toBeUndefined();
  });
});
