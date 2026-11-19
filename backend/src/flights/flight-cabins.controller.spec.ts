import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FlightCabinsController } from './flight-cabins.controller';
import type { FlightCabinsService } from './flight-cabins.service';
import { CabinClass } from './models/cabin-class.enum';

describe('FlightCabinsController (FLT-04)', () => {
  const flightId = '6740f1c2a4b5c6d7e8f90456';
  const cabinId = '6740f1c2a4b5c6d7e8f90789';

  const setup = () => {
    const answer = { id: flightId };
    const service = {
      addCabin: jest.fn().mockResolvedValue(answer),
      updateCabin: jest.fn().mockResolvedValue(answer),
    };
    const controller = new FlightCabinsController(
      service as unknown as FlightCabinsService,
    );
    return { answer, service, controller };
  };

  it('passes the flight id, the body and the logged-in user to addCabin and returns its answer', async () => {
    const { answer, service, controller } = setup();
    const dto = {
      cabin: CabinClass.Economy,
      totalSeats: 180,
      price: 25000,
      freeBags: 1,
      maxBagKg: 23,
    };

    await expect(
      controller.addCabin(flightId, dto, 'moderator-1'),
    ).resolves.toBe(answer);
    expect(service.addCabin).toHaveBeenCalledWith(flightId, dto, 'moderator-1');
  });

  it('passes both ids, the body and the logged-in user to updateCabin and returns its answer', async () => {
    const { answer, service, controller } = setup();

    await expect(
      controller.updateCabin(flightId, cabinId, { price: 1 }, 'moderator-1'),
    ).resolves.toBe(answer);
    expect(service.updateCabin).toHaveBeenCalledWith(
      flightId,
      cabinId,
      { price: 1 },
      'moderator-1',
    );
  });

  it.each(['addCabin', 'updateCabin'] as const)(
    '%s is for airline moderators only, and needs a login',
    (name) => {
      const reflector = new Reflector();
      const handler = FlightCabinsController.prototype[name];

      expect(reflector.get(ROLES_KEY, handler)).toEqual([
        Role.AirlineModerator,
      ]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          FlightCabinsController,
        ]),
      ).toBeUndefined();
    },
  );
});
