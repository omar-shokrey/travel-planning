import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IMAGE_LIMITS } from '../uploads/uploads.constants';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.types';
import { ActivitiesService } from './activities.service';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { ItinerariesService } from './itineraries.service';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

/** How many images an activity may have (GEN-08), and the answer past it. */
const MAX_ACTIVITY_IMAGES = IMAGE_LIMITS.activity.max;
export const ACTIVITY_IMAGE_LIMIT_MESSAGE = `${IMAGE_LIMITS.activity.subject} can have at most ${MAX_ACTIVITY_IMAGES} ${IMAGE_LIMITS.activity.thing}s.`;

/**
 * ITN-12: the images of an activity (GEN-08). Only the itinerary's owner
 * adds or removes them. The activity keeps the stored file names; the files
 * are served at `/api/uploads/<name>`.
 *
 * Every write is one conditional update on that one activity, found with
 * `arrayFilters`, never a rewrite of the days. Every write also bumps the
 * itinerary's version (`__v`): `writeDays` (ITN-07, ITN-08) and
 * `saveOrConflict` (ITN-10) replace arrays only at the version they read, so
 * a request that read the activity before an image changed gets 409 instead
 * of silently dropping that image and leaving its file behind.
 */
@Injectable()
export class ActivityImagesService {
  private readonly logger = new Logger(ActivityImagesService.name);

  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly activities: ActivitiesService,
    private readonly itinerariesService: ItinerariesService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Checks the limit, saves the files, then adds their names to the activity
   * in one conditional update that matches only while the activity still has
   * room for all of them, so two uploads at the same time can never pass 5.
   * When the update does not match, or anything fails after the files were
   * saved, the new files are deleted again: no orphan file stays on disk.
   */
  async addImages(
    activityId: string,
    userId: string,
    files: readonly ImageFile[] | undefined,
  ): Promise<ItineraryDetailResponseDto> {
    const { itinerary, activity } =
      await this.activities.findOwnedActivityOrThrow(activityId, userId);
    this.uploads.assertWithinLimit(
      'activity',
      activity.images.length,
      files?.length ?? 0,
    );

    const stored = await this.uploads.saveImages(files);
    const names = stored.map(({ filename }) => filename);
    const id = new Types.ObjectId(activityId);
    let updated: ItineraryDocument | null;
    try {
      updated = await this.itineraries
        .findOneAndUpdate(
          {
            _id: itinerary._id,
            'days.activities': {
              $elemMatch: {
                _id: id,
                // There is room for all of them: the list has no element at
                // the position the first image past the limit would take.
                [`images.${MAX_ACTIVITY_IMAGES - names.length}`]: {
                  $exists: false,
                },
              },
            },
          },
          {
            $push: {
              'days.$[].activities.$[activity].images': { $each: names },
            },
            $inc: { __v: 1 },
          },
          { arrayFilters: [{ 'activity._id': id }], returnDocument: 'after' },
        )
        .exec();
      if (!updated) {
        // Another upload took the room, or the activity is gone.
        if (!(await this.activityExists(id))) {
          throw new NotFoundException('Activity not found');
        }
        throw new BadRequestException(ACTIVITY_IMAGE_LIMIT_MESSAGE);
      }
    } catch (error) {
      await this.deleteSavedFiles(names);
      throw error;
    }
    // The names are stored now, so nothing below may delete their files.
    return toItineraryDetailResponse(updated);
  }

  /**
   * Takes one image off the activity in one conditional update, then deletes
   * its file unless another activity still lists it (a clone, ITN-21).
   * `imageId` is the stored file name. A name the activity does not list is
   * 404, and no file is touched.
   */
  async removeImage(
    activityId: string,
    imageId: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const { itinerary } = await this.activities.findOwnedActivityOrThrow(
      activityId,
      userId,
    );
    const id = new Types.ObjectId(activityId);
    const updated = await this.itineraries
      .findOneAndUpdate(
        {
          _id: itinerary._id,
          'days.activities': { $elemMatch: { _id: id, images: imageId } },
        },
        {
          $pull: { 'days.$[].activities.$[activity].images': imageId },
          $inc: { __v: 1 },
        },
        { arrayFilters: [{ 'activity._id': id }], returnDocument: 'after' },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Activity image not found');
    }
    await this.itinerariesService.deleteUnusedImageFiles([imageId]);
    return toItineraryDetailResponse(updated);
  }

  private async activityExists(id: Types.ObjectId): Promise<boolean> {
    return (
      (await this.itineraries.exists({ 'days.activities._id': id })) !== null
    );
  }

  /**
   * Deletes the files of an upload that failed. Every file is tried, and a
   * file that cannot be deleted is logged, so the caller still gets the
   * error that made the upload fail (400, 404 or the database error), not a
   * 500 from the cleanup.
   */
  private async deleteSavedFiles(names: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      names.map((name) => this.uploads.deleteImage(name)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Could not delete the uploaded file ${names[index]} after a failed upload`,
          result.reason instanceof Error ? result.reason.stack : undefined,
        );
      }
    });
  }
}
