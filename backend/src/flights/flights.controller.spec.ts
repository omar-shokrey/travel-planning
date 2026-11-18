import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FlightsController } from './flights.controller';
import type { FlightsService } from './flights.service';

describe('FlightsController (FLT-03)', () => {
  const dto = {
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureLocal: '2027-06-15T14:30',
    arrivalLocal: '2027-06-15T18:30',
  };

  it('passes the body and the logged-in user to the service and returns its answer', async () => {
    const created = { id: 'flight-1' };
    const service = { create: jest.fn().mockResolvedValue(created) };
    const controller = new FlightsController(
      service as unknown as FlightsService,
    );

    await expect(controller.create(dto, 'moderator-1')).resolves.toBe(created);
    expect(service.create).toHaveBeenCalledWith(dto, 'moderator-1');
  });

  it('is for airline moderators only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = FlightsController.prototype.create;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.AirlineModerator]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, FlightsController]),
    ).toBeUndefined();
  });
});
