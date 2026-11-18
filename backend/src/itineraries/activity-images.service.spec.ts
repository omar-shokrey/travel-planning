import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Mongoose, Types, type Model } from 'mongoose';
import type { UploadsService } from '../uploads/uploads.service';
import type { ActivitiesService } from './activities.service';
import {
  ACTIVITY_IMAGE_LIMIT_MESSAGE,
  ActivityImagesService,
} from './activity-images.service';
import type { ItinerariesService } from './itineraries.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected, so the response is mapped as in the app.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId().toString();
const files = [
  { originalname: 'a.png', buffer: Buffer.from('a') },
  { originalname: 'b.png', buffer: Buffer.from('b') },
];

/** An itinerary with one day and one activity that has these images. */
function itineraryWith(images: string[]): ItineraryDocument {
  return new ItineraryModel({
    ownerId: new Types.ObjectId(ownerId),
    title: 'Egypt',
    countries: ['EG'],
    startDate: '2026-12-20',
    dayCount: 1,
    days: [{ cityId: 'cairo', activities: [{ name: 'Museum', images }] }],
  }) as ItineraryDocument;
}

function setup(images: string[] = []) {
  const itinerary = itineraryWith(images);
  const activity = itinerary.days[0].activities[0];
  const activityId = activity._id.toString();
  const updateExec = jest.fn();
  const itineraries = {
    findOneAndUpdate: jest.fn(() => ({ exec: updateExec })),
    exists: jest.fn().mockResolvedValue({ _id: itinerary._id }),
  };
  const activities = {
    findOwnedActivityOrThrow: jest.fn().mockResolvedValue({
      itinerary,
      day: itinerary.days[0],
      activity,
    }),
  };
  const itinerariesService = {
    deleteUnusedImageFiles: jest.fn().mockResolvedValue(undefined),
  };
  const uploads = {
    // The real limit check, so the tests see its answer.
    assertWithinLimit: jest.fn(
      (_owner: string, existing: number, incoming: number) => {
        if (existing + incoming > 5) {
          throw new BadRequestException(
            `An activity can have at most 5 images.${existing > 0 ? ` It already has ${existing}.` : ''}`,
          );
        }
      },
    ),
    saveImages: jest.fn().mockResolvedValue([
      { filename: 'new-1.png', url: '/api/uploads/new-1.png' },
      { filename: 'new-2.png', url: '/api/uploads/new-2.png' },
    ]),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ActivityImagesService(
    itineraries as unknown as Model<Itinerary>,
    activities as unknown as ActivitiesService,
    itinerariesService as unknown as ItinerariesService,
    uploads as unknown as UploadsService,
  );
  /** What the database returns after the update: the activity with these images. */
  const after = (names: string[]) => {
    const updated = itineraryWith(names);
    updated._id = itinerary._id;
    updated.days[0].activities[0]._id = activity._id;
    return updated;
  };
  return {
    service,
    itinerary,
    activityId,
    itineraries,
    activities,
    itinerariesService,
    uploads,
    updateExec,
    after,
  };
}

describe('ActivityImagesService (ITN-12)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addImages', () => {
    it('checks the limit, saves the files, then adds the names in one conditional update', async () => {
      const t = setup(['old.jpg']);
      t.updateExec.mockResolvedValue(
        t.after(['old.jpg', 'new-1.png', 'new-2.png']),
      );

      const response = await t.service.addImages(t.activityId, ownerId, files);

      expect(t.activities.findOwnedActivityOrThrow).toHaveBeenCalledWith(
        t.activityId,
        ownerId,
      );
      expect(t.uploads.assertWithinLimit).toHaveBeenCalledWith(
        'activity',
        1,
        2,
      );
      expect(t.uploads.saveImages).toHaveBeenCalledWith(files);
      const id = new Types.ObjectId(t.activityId);
      expect(t.itineraries.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: t.itinerary._id,
          'days.activities': {
            $elemMatch: { _id: id, 'images.3': { $exists: false } },
          },
        },
        {
          $push: {
            'days.$[].activities.$[activity].images': {
              $each: ['new-1.png', 'new-2.png'],
            },
          },
          $inc: { __v: 1 },
        },
        { arrayFilters: [{ 'activity._id': id }], returnDocument: 'after' },
      );
      expect(response.days[0].activities[0].images).toEqual([
        { filename: 'old.jpg', url: '/api/uploads/old.jpg' },
        { filename: 'new-1.png', url: '/api/uploads/new-1.png' },
        { filename: 'new-2.png', url: '/api/uploads/new-2.png' },
      ]);
      expect(t.uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('bumps the version, so a day or activity write based on an older read gets 409', async () => {
      const t = setup();
      t.updateExec.mockResolvedValue(t.after(['new-1.png', 'new-2.png']));

      await t.service.addImages(t.activityId, ownerId, files);

      const calls = t.itineraries.findOneAndUpdate.mock.calls as unknown as [
        unknown,
        { $inc: Record<string, number> },
      ][];
      expect(calls[0][1].$inc).toEqual({ __v: 1 });
    });

    it('refuses past 5 images before saving anything', async () => {
      const t = setup(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(
        'An activity can have at most 5 images. It already has 4.',
      );
      expect(t.uploads.saveImages).not.toHaveBeenCalled();
      expect(t.itineraries.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('a lost race: the update finds no room, so 400 and the saved files are deleted', async () => {
      const t = setup(['1.jpg', '2.jpg', '3.jpg']);
      t.updateExec.mockResolvedValue(null);

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(new BadRequestException(ACTIVITY_IMAGE_LIMIT_MESSAGE));
      expect(t.uploads.deleteImage.mock.calls).toEqual([
        ['new-1.png'],
        ['new-2.png'],
      ]);
    });

    it('answers 404 and deletes the saved files when the activity was deleted in the meantime', async () => {
      const t = setup();
      t.updateExec.mockResolvedValue(null);
      t.itineraries.exists.mockResolvedValue(null);

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(new NotFoundException('Activity not found'));
      expect(t.uploads.deleteImage).toHaveBeenCalledTimes(2);
    });

    it('deletes the saved files when the database fails, and answers that error', async () => {
      const t = setup();
      const failure = new Error('connection lost');
      t.updateExec.mockRejectedValue(failure);

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toBe(failure);
      expect(t.uploads.deleteImage).toHaveBeenCalledTimes(2);
    });

    it('tries every file, logs one that cannot be deleted, and still answers the original error', async () => {
      const t = setup();
      t.updateExec.mockResolvedValue(null);
      t.uploads.deleteImage
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce(undefined);
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(new BadRequestException(ACTIVITY_IMAGE_LIMIT_MESSAGE));
      expect(t.uploads.deleteImage.mock.calls).toEqual([
        ['new-1.png'],
        ['new-2.png'],
      ]);
      expect(logged).toHaveBeenCalledWith(
        'Could not delete the uploaded file new-1.png after a failed upload',
        expect.any(String),
      );
    });

    it('saves nothing when a file is refused (413 or 415 comes from UploadsService)', async () => {
      const t = setup();
      t.uploads.saveImages.mockRejectedValue(
        new PayloadTooLargeException('a.png is larger than 5 MB'),
      );

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(t.itineraries.findOneAndUpdate).not.toHaveBeenCalled();
      expect(t.uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('answers what the activity lookup answers (404 or 403) before reading any file', async () => {
      const t = setup();
      t.activities.findOwnedActivityOrThrow.mockRejectedValue(
        new ForbiddenException('You can only change your own itineraries'),
      );

      await expect(
        t.service.addImages(t.activityId, ownerId, files),
      ).rejects.toThrow(ForbiddenException);
      expect(t.uploads.saveImages).not.toHaveBeenCalled();
    });
  });

  describe('removeImage', () => {
    it('pulls the name in one conditional update with the version bump, then deletes the file if unused', async () => {
      const t = setup(['a.jpg', 'b.jpg']);
      t.updateExec.mockResolvedValue(t.after(['b.jpg']));

      const response = await t.service.removeImage(
        t.activityId,
        'a.jpg',
        ownerId,
      );

      const id = new Types.ObjectId(t.activityId);
      expect(t.itineraries.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: t.itinerary._id,
          'days.activities': { $elemMatch: { _id: id, images: 'a.jpg' } },
        },
        {
          $pull: { 'days.$[].activities.$[activity].images': 'a.jpg' },
          $inc: { __v: 1 },
        },
        { arrayFilters: [{ 'activity._id': id }], returnDocument: 'after' },
      );
      // The shared rule decides: a clone may still list it.
      expect(t.itinerariesService.deleteUnusedImageFiles).toHaveBeenCalledWith([
        'a.jpg',
      ]);
      expect(t.uploads.deleteImage).not.toHaveBeenCalled();
      expect(response.days[0].activities[0].images).toEqual([
        { filename: 'b.jpg', url: '/api/uploads/b.jpg' },
      ]);
    });

    it('answers 404 for a name the activity does not list, and touches no file', async () => {
      const t = setup(['a.jpg']);
      t.updateExec.mockResolvedValue(null);

      await expect(
        t.service.removeImage(t.activityId, 'unknown.jpg', ownerId),
      ).rejects.toThrow(new NotFoundException('Activity image not found'));
      expect(
        t.itinerariesService.deleteUnusedImageFiles,
      ).not.toHaveBeenCalled();
      expect(t.uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('answers what the activity lookup answers (404 or 403) and changes nothing', async () => {
      const t = setup(['a.jpg']);
      t.activities.findOwnedActivityOrThrow.mockRejectedValue(
        new NotFoundException('Activity not found'),
      );

      await expect(
        t.service.removeImage(t.activityId, 'a.jpg', ownerId),
      ).rejects.toThrow(NotFoundException);
      expect(t.itineraries.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
