import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
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

  /** Every activity route needs a login as a registered user (ITN-01). */
  function expectRegisteredUsersOnly(handler: (...args: never[]) => unknown) {
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        ActivitiesController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [handler, ActivitiesController]),
    ).toEqual([Role.User]);
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

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(ActivitiesController.prototype.update);
    });
  });

  describe('remove (ITN-10)', () => {
    it('gives the service the activity id and the logged-in user, and returns its answer', async () => {
      const { activitiesService, controller } = setup();

      expect(await controller.remove(activityId, userId)).toBe(itinerary);
      expect(activitiesService.remove).toHaveBeenCalledWith(activityId, userId);
    });

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(ActivitiesController.prototype.remove);
    });
  });
});
