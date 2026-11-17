import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AirlinesController } from './airlines.controller';
import type { AirlinesService } from './airlines.service';

const airlineId = '6740f1c2a4b5c6d7e8f90123';
const userId = '6740f1c2a4b5c6d7e8f90124';

describe('AirlinesController', () => {
  describe('setCancellationPolicy (FLT-09)', () => {
    it('gives the service the airline id, the logged-in user and the body, and returns its answer', async () => {
      const airline = { id: airlineId, cancellationTiers: [] };
      const service = {
        setCancellationPolicy: jest.fn().mockResolvedValue(airline),
      };
      const controller = new AirlinesController(
        service as unknown as AirlinesService,
      );
      const body = { tiers: [{ daysBefore: 7, refundPercent: 50 }] };

      await expect(
        controller.setCancellationPolicy(airlineId, body, userId),
      ).resolves.toBe(airline);
      expect(service.setCancellationPolicy).toHaveBeenCalledWith(
        airlineId,
        userId,
        body,
      );
    });

    it('needs a login and is open to airline moderators only', () => {
      const reflector = new Reflector();
      const handler = AirlinesController.prototype.setCancellationPolicy;

      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, handler)).toEqual([
        Role.AirlineModerator,
      ]);
    });
  });
});
