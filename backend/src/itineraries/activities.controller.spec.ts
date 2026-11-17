import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ActivitiesController } from './activities.controller';
import type { ActivitiesService } from './activities.service';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { UpdateActivityDto } from './dto/update-activity.dto';

describe('ActivitiesController', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const activityId = '6740f1c2a4b5c6d7e8f90456';
  const itinerary = {
    id: '6740f1c2a4b5c6d7e8f90789',
  } as ItineraryDetailResponseDto;

  function setup() {
    const activitiesService = {
      update: jest.fn().mockResolvedValue(itinerary),
      remove: jest.fn().mockResolvedValue(itinerary),
    };
    const controller = new ActivitiesController(
      activitiesService as unknown as ActivitiesService,
    );
    return { activitiesService, controller };
  }

  /** Every activity route needs a login and is open to every role. */
  function expectLoginForEveryRole(handler: (...args: never[]) => unknown) {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, ActivitiesController)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, ActivitiesController)).toBeUndefined();
  }

  describe('update (ITN-10)', () => {
    it('gives the service the activity id, the body and the logged-in user, and returns its answer', async () => {
      const { activitiesService, controller } = setup();
      const body: UpdateActivityDto = { name: 'Old town walk', cost: 1500 };

      expect(await controller.update(activityId, body, userId)).toBe(itinerary);
      expect(activitiesService.update).toHaveBeenCalledWith(
        activityId,
        body,
        userId,
      );
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(ActivitiesController.prototype.update);
    });
  });

  describe('remove (ITN-10)', () => {
    it('gives the service the activity id and the logged-in user, and returns its answer', async () => {
      const { activitiesService, controller } = setup();

      expect(await controller.remove(activityId, userId)).toBe(itinerary);
      expect(activitiesService.remove).toHaveBeenCalledWith(activityId, userId);
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(ActivitiesController.prototype.remove);
    });
  });
});
