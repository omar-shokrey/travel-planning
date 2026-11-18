import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CreateActivityDto } from './dto/create-activity.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { assertNoNullFields } from './dto/null-fields';
import type { UpdateActivityDto } from './dto/update-activity.dto';
import { ItinerariesService } from './itineraries.service';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import type { Activity } from './models/activity.schema';
import type { ItineraryDay } from './models/itinerary-day.schema';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

/** Where an activity sits: its itinerary, its day and the activity itself. */
export interface ActivityLocation {
  itinerary: ItineraryDocument;
  day: ItineraryDay;
  activity: Activity;
}

/**
 * ITN-10: the activities of a day. They are embedded in the itinerary, so
 * every change is a change of the itinerary document: the owner check, the
 * version check (saveOrConflict) and the response are the itinerary's.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  /** ITN-10: add an activity at the end of a day of your own itinerary. */
  async add(
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
    );
    const day = this.itinerariesService.findDayOrThrow(itinerary, dayId);
    if (dto.currency) {
      await this.itinerariesService.assertCurrencySupported(dto.currency);
    }

    day.activities.push({
      name: dto.name,
      ...(dto.description ? { description: dto.description } : {}),
      ...(dto.time ? { time: dto.time } : {}),
      ...(dto.cost !== undefined
        ? { cost: dto.cost, currency: dto.currency }
        : {}),
    } as Activity);
    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * ITN-10: edit an activity of your own itinerary. Send only what changes;
   * an empty description or time removes it. A cost and its currency always
   * go together.
   */
  async update(
    activityId: string,
    dto: UpdateActivityDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    assertNoNullFields(dto);
    const { itinerary, activity } = await this.findOwnedActivityOrThrow(
      activityId,
      userId,
    );

    const cost = dto.cost !== undefined ? dto.cost : activity.cost;
    const currency =
      dto.currency !== undefined ? dto.currency : activity.currency;
    if ((cost == null) !== (currency == null)) {
      throw new BadRequestException(
        'cost and currency go together: send both, or neither',
      );
    }
    if (dto.currency !== undefined) {
      await this.itinerariesService.assertCurrencySupported(dto.currency);
    }

    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined) {
      activity.description = dto.description || undefined;
    }
    if (dto.time !== undefined) activity.time = dto.time || undefined;
    if (dto.cost !== undefined) activity.cost = dto.cost;
    if (dto.currency !== undefined) activity.currency = dto.currency;

    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * ITN-10: delete an activity of your own itinerary. ITN-12: then its image
   * files that no other activity lists (a clone shares them, ITN-21).
   */
  async remove(
    activityId: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const { itinerary, day, activity } = await this.findOwnedActivityOrThrow(
      activityId,
      userId,
    );
    // Current at the version read: every image write bumps the version
    // (ITN-12), so if one happened in between, saveOrConflict answers 409.
    const images = [...activity.images];

    // A new array is written with $set, so the day loses exactly this one.
    // Replacing an array makes Mongoose check and bump the version.
    day.activities = day.activities.filter(
      (candidate) => candidate._id.toString() !== activityId,
    );
    await this.itinerariesService.saveOrConflict(itinerary);
    await this.itinerariesService.deleteUnusedImageFiles(images);
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * Finds the itinerary that holds this activity: 404, then 403 if it is not
   * yours. Also used by `ActivityImagesService` (ITN-12).
   */
  async findOwnedActivityOrThrow(
    activityId: string,
    userId: string,
  ): Promise<ActivityLocation> {
    const itinerary = await this.itineraries.findOne({
      'days.activities._id': new Types.ObjectId(activityId),
    });
    if (!itinerary) {
      throw new NotFoundException('Activity not found');
    }
    if (itinerary.ownerId.toString() !== userId) {
      throw new ForbiddenException('You can only change your own itineraries');
    }
    for (const day of itinerary.days) {
      const activity = day.activities.find(
        (candidate) => candidate._id.toString() === activityId,
      );
      if (activity) return { itinerary, day, activity };
    }
    throw new NotFoundException('Activity not found');
  }
}
