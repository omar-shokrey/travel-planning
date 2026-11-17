import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { TransportCostsController } from './transport-costs.controller';
import type { TransportCostsService } from './transport-costs.service';

describe('TransportCostsController', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const transportCostId = '6740f1c2a4b5c6d7e8f90456';
  const itinerary = {
    id: '6740f1c2a4b5c6d7e8f90789',
  } as ItineraryDetailResponseDto;

  function setup() {
    const transportCostsService = {
      update: jest.fn().mockResolvedValue(itinerary),
      remove: jest.fn().mockResolvedValue(itinerary),
    };
    const controller = new TransportCostsController(
      transportCostsService as unknown as TransportCostsService,
    );
    return { transportCostsService, controller };
  }

  /** Every transport cost route needs a login and is open to every role. */
  function expectLoginForEveryRole(handler: (...args: never[]) => unknown) {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(
      reflector.get(IS_PUBLIC_KEY, TransportCostsController),
    ).toBeUndefined();
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, TransportCostsController)).toBeUndefined();
  }

  describe('update (ITN-16)', () => {
    it('gives the service the transport cost id, the body and the logged-in user, and returns its answer', async () => {
      const { transportCostsService, controller } = setup();
      const body: UpdateTransportCostDto = { mode: 'bus', amount: 700 };

      expect(await controller.update(transportCostId, body, userId)).toBe(
        itinerary,
      );
      expect(transportCostsService.update).toHaveBeenCalledWith(
        transportCostId,
        body,
        userId,
      );
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(TransportCostsController.prototype.update);
    });
  });

  describe('remove (ITN-16)', () => {
    it('gives the service the transport cost id and the logged-in user, and returns its answer', async () => {
      const { transportCostsService, controller } = setup();

      expect(await controller.remove(transportCostId, userId)).toBe(itinerary);
      expect(transportCostsService.remove).toHaveBeenCalledWith(
        transportCostId,
        userId,
      );
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(TransportCostsController.prototype.remove);
    });
  });
});
