import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ActivitiesController } from './activities.controller';
import type { ActivitiesService } from './activities.service';
import type { ActivityImagesService } from './activity-images.service';
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
    const activityImagesService = {
      addImages: jest.fn().mockResolvedValue(itinerary),
      removeImage: jest.fn().mockResolvedValue(itinerary),
    };
    const controller = new ActivitiesController(
      activitiesService as unknown as ActivitiesService,
      activityImagesService as unknown as ActivityImagesService,
    );
    return { activitiesService, activityImagesService, controller };
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

  describe('addImages (ITN-12)', () => {
    it('gives the service the activity id, the logged-in user and the files, and returns its answer', async () => {
      const { activityImagesService, controller } = setup();
      const files = [
        { originalname: 'a.png', buffer: Buffer.from('a') },
      ] as never[];

      expect(await controller.addImages(activityId, userId, files)).toBe(
        itinerary,
      );
      expect(activityImagesService.addImages).toHaveBeenCalledWith(
        activityId,
        userId,
        files,
      );
    });

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(ActivitiesController.prototype.addImages);
    });
  });

  describe('removeImage (ITN-12)', () => {
    it('gives the service the activity id, the image name and the logged-in user, and returns its answer', async () => {
      const { activityImagesService, controller } = setup();
      const imageId = 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg';

      expect(await controller.removeImage(activityId, imageId, userId)).toBe(
        itinerary,
      );
      expect(activityImagesService.removeImage).toHaveBeenCalledWith(
        activityId,
        imageId,
        userId,
      );
    });

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(ActivitiesController.prototype.removeImage);
    });
  });
});
