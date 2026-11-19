import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { FlightDetailsController } from './flight-details.controller';
import type { FlightDetailsService } from './flight-details.service';

describe('FlightDetailsController (FLT-17)', () => {
  it('passes the flight id to the service and returns its answer', async () => {
    const details = { id: 'flight-1' };
    const service = { findDetails: jest.fn().mockResolvedValue(details) };
    const controller = new FlightDetailsController(
      service as unknown as FlightDetailsService,
    );

    await expect(controller.findOne('flight-1')).resolves.toBe(details);
    expect(service.findDetails).toHaveBeenCalledWith('flight-1');
  });

  it('is open to guests, with no role and no lock in Swagger', () => {
    const reflector = new Reflector();
    const handler = FlightDetailsController.prototype.findOne;

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata('swagger/apiSecurity', handler)).toBeUndefined();
  });
});
