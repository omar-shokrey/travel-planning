import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import type { AddDayDto } from './dto/add-day.dto';
import type { CreateItineraryDto } from './dto/create-itinerary.dto';
import type { MoveDayDto } from './dto/move-day.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from './dto/itinerary-response.dto';
import type { UpdateDayDto } from './dto/update-day.dto';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto';
import {
  ITINERARY_CHANGED_MESSAGE,
  ITINERARY_MAX_DAYS,
} from './itineraries.constants';
import {
  toItineraryDetailResponse,
  toItineraryResponse,
} from './mappers/itinerary.mapper';
import type { ItineraryDay } from './models/itinerary-day.schema';
import { PUBLICLY_VISIBLE } from './public-itineraries.service';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  /** ITN-01: create an itinerary. The owner is the logged-in user and it starts private. */
  async create(
    dto: CreateItineraryDto,
    userId: string,
  ): Promise<ItineraryResponseDto> {
    await this.assertCountriesExist(dto.countries);

    const itinerary = await this.itineraries.create({
      title: dto.title,
      countries: dto.countries,
      startDate: dto.startDate,
      ownerId: new Types.ObjectId(userId),
    });
    return toItineraryResponse(itinerary);
  }

  /** ITN-03: the caller's itineraries, most recently updated first. */
  async findMine(
    query: PaginationQueryDto,
    userId: string,
  ): Promise<PaginatedResponse<ItineraryResponseDto>> {
    const filter = { ownerId: new Types.ObjectId(userId) };
    const [itineraries, total] = await Promise.all([
      this.itineraries
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit),
      this.itineraries.countDocuments(filter),
    ]);
    return paginate(itineraries.map(toItineraryResponse), total, query);
  }

  /** ITN-03: one of the caller's itineraries with its days. */
  async findOne(
    id: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.findOwnedOrThrow(
      id,
      userId,
      'You can only open your own itineraries',
    );
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * ITN-01: edit the title, the countries or the start date of your own itinerary.
   * ITN-20: make it public or private.
   */
  async update(
    id: string,
    dto: UpdateItineraryDto,
    userId: string,
  ): Promise<ItineraryResponseDto> {
    const itinerary = await this.findOwnedOrThrow(id, userId);

    // A field that is absent or null is left as it is.
    if (dto.countries != null) {
      await this.assertCountriesExist(dto.countries);
      itinerary.countries = dto.countries;
    }
    if (dto.title != null) {
      itinerary.title = dto.title;
    }
    if (dto.startDate != null) {
      itinerary.startDate = dto.startDate;
    }
    // ITN-20: public search reads this field, so a change applies at once.
    if (dto.visibility != null) {
      itinerary.visibility = dto.visibility;
    }

    await itinerary.save();
    return toItineraryResponse(itinerary);
  }

  /**
   * ITN-01: delete your own itinerary. The document is removed, so it leaves
   * public search at once. A clone is a separate document and is not touched.
   */
  async remove(id: string, userId: string): Promise<void> {
    const itinerary = await this.findOwnedOrThrow(id, userId);
    await itinerary.deleteOne();
  }

  /**
   * ITN-05: add a day at the end of your own itinerary. One conditional update
   * adds the day and counts it, and only while there are fewer than 60, so two
   * requests at the same moment cannot pass the limit or leave `dayCount`
   * different from the number of days. It bumps the version, so a delete or a
   * move that read the itinerary before this day existed cannot drop it.
   */
  async addDay(
    id: string,
    dto: AddDayDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    await this.findOwnedOrThrow(id, userId);
    await this.assertCityExists(dto.cityId);

    const day = {
      cityId: dto.cityId,
      ...(dto.notes ? { notes: dto.notes } : {}),
    };
    const itinerary = await this.itineraries.findOneAndUpdate(
      { _id: id, dayCount: { $lt: ITINERARY_MAX_DAYS } },
      { $push: { days: day }, $inc: { dayCount: 1, __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!itinerary) {
      throw new ConflictException(
        `An itinerary has at most ${ITINERARY_MAX_DAYS} days`,
      );
    }
    return toItineraryDetailResponse(itinerary);
  }

  /** ITN-05: edit the city or the notes of a day of your own itinerary. */
  async updateDay(
    id: string,
    dayId: string,
    dto: UpdateDayDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.findOwnedOrThrow(id, userId);
    const day = itinerary.days.find(
      (candidate) => candidate._id.toString() === dayId,
    );
    if (!day) {
      throw new NotFoundException('Day not found');
    }

    // A field that is absent or null is left as it is.
    if (dto.cityId != null) {
      await this.assertCityExists(dto.cityId);
      day.cityId = dto.cityId;
    }
    if (dto.notes != null) {
      day.notes = dto.notes;
    }

    await this.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * ITN-07: delete a day of your own itinerary. The days after it move up one
   * place, so their numbers and dates change; both are computed when read.
   *
   * One update writes the remaining days and their count, and only if the
   * itinerary is still at the version that was read, so `dayCount` always
   * equals the number of days and a day added or moved in the meantime is
   * never lost. The update bumps the version, so any save that still holds
   * the old positions is refused too.
   */
  async removeDay(
    id: string,
    dayId: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.findOwnedOrThrow(id, userId);
    this.findDayOrThrow(itinerary, dayId);

    const remaining = this.daysAsObjects(itinerary).filter(
      (day) => day._id.toString() !== dayId,
    );
    const updated = await this.writeDays(itinerary, remaining);
    return toItineraryDetailResponse(updated);
  }

  /**
   * ITN-08: move a day of your own itinerary to a new position. The days in
   * between shift by one, and every number and date follows from the new
   * order when read. The new order is written with the same version check as
   * a delete (ITN-07).
   */
  async moveDay(
    id: string,
    dto: MoveDayDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.findOwnedOrThrow(id, userId);
    this.findDayOrThrow(itinerary, dto.dayId);
    if (dto.position > itinerary.days.length) {
      throw new BadRequestException(
        `position must be between 1 and ${itinerary.days.length}, the number of days`,
      );
    }

    const days = this.daysAsObjects(itinerary);
    const from = days.findIndex((day) => day._id.toString() === dto.dayId);
    const to = dto.position - 1;
    if (from === to) {
      return toItineraryDetailResponse(itinerary);
    }
    const [moved] = days.splice(from, 1);
    days.splice(to, 0, moved);

    return toItineraryDetailResponse(await this.writeDays(itinerary, days));
  }

  /** The days of an itinerary as plain objects that keep their ids. */
  private daysAsObjects(
    itinerary: ItineraryDocument,
  ): (Record<string, unknown> & { _id: Types.ObjectId })[] {
    return itinerary.days.map((day) =>
      (
        day as unknown as {
          toObject(): Record<string, unknown> & { _id: Types.ObjectId };
        }
      ).toObject(),
    );
  }

  /**
   * Replaces the days of an itinerary in one update, only if it is still at
   * the version that was read, and bumps the version (ITN-07, ITN-08). A
   * request that lost the race gets 409.
   */
  private async writeDays(
    itinerary: ItineraryDocument,
    days: Record<string, unknown>[],
  ): Promise<ItineraryDocument> {
    const updated = await this.itineraries.findOneAndUpdate(
      { _id: itinerary._id, __v: itinerary.__v },
      { $set: { days, dayCount: days.length }, $inc: { __v: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throw new ConflictException(ITINERARY_CHANGED_MESSAGE);
    }
    return updated;
  }

  /**
   * Saves an itinerary that was changed in memory. If another request changed
   * the order of its days in the meantime, Mongoose refuses the save (the
   * version no longer matches), because a change by position could hit the
   * wrong day. That is a 409, so the client reloads and tries again.
   */
  async saveOrConflict(itinerary: ItineraryDocument): Promise<void> {
    try {
      await itinerary.save();
    } catch (error) {
      if (error instanceof MongooseError.VersionError) {
        throw new ConflictException(ITINERARY_CHANGED_MESSAGE);
      }
      throw error;
    }
  }

  /** The day of this itinerary with this id, or 404. */
  findDayOrThrow(itinerary: ItineraryDocument, dayId: string): ItineraryDay {
    const day = itinerary.days.find(
      (candidate) => candidate._id.toString() === dayId,
    );
    if (!day) {
      throw new NotFoundException('Day not found');
    }
    return day;
  }

  /** For other services, which need the entity. Never return it from a controller. */
  async findEntityOrThrow(id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries.findById(id);
    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }
    return itinerary;
  }

  /**
   * For other services (reports, GEN-09): the owner of an itinerary and
   * whether everyone may see it, by the same rule as public search (ITN-21,
   * `PUBLICLY_VISIBLE`), so the two cannot disagree. Reads only those four
   * fields, not the days. 404 when the itinerary does not exist.
   */
  async findOwnerAndVisibilityOrThrow(
    id: string,
  ): Promise<{ ownerId: string; publiclyVisible: boolean }> {
    const itinerary = await this.itineraries
      .findById(id)
      .select('ownerId visibility moderation authorDeactivated')
      .lean()
      .exec();
    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }
    const fields = Object.keys(
      PUBLICLY_VISIBLE,
    ) as (keyof typeof PUBLICLY_VISIBLE)[];
    return {
      ownerId: itinerary.ownerId.toString(),
      publiclyVisible: fields.every(
        (field) => itinerary[field] === PUBLICLY_VISIBLE[field],
      ),
    };
  }

  /**
   * Loads an itinerary and checks that the caller owns it: 404, then 403.
   * Also used by the activity and transport cost services of this module.
   */
  async findOwnedOrThrow(
    id: string,
    userId: string,
    forbiddenMessage = 'You can only change your own itineraries',
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findEntityOrThrow(id);
    if (itinerary.ownerId.toString() !== userId) {
      throw new ForbiddenException(forbiddenMessage);
    }
    return itinerary;
  }

  /** ITN-01: countries come from the seeded country list (GEN-12). */
  private async assertCountriesExist(codes: string[]): Promise<void> {
    const found = await this.countries
      .find({ _id: { $in: codes } })
      .select('_id')
      .lean();
    const known = new Set(found.map((country) => country._id));
    const unknown = codes.filter((code) => !known.has(code));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown country code: ${unknown.join(', ')}`,
      );
    }
  }

  /**
   * ITN-10, ITN-14, ITN-16: money in an itinerary uses a supported currency,
   * one of the currency codes in the seeded country list (GEN-12).
   */
  async assertCurrencySupported(currency: string): Promise<void> {
    const country = await this.countries.exists({ currency });
    if (!country) {
      throw new BadRequestException(`Unsupported currency: ${currency}`);
    }
  }

  /** ITN-05, ITN-16: a city comes from the seeded city list (GEN-12). */
  async assertCityExists(cityId: string): Promise<void> {
    const city = await this.cities.exists({ _id: cityId });
    if (!city) {
      throw new BadRequestException(`Unknown city id: ${cityId}`);
    }
  }
}
