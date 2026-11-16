import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import type { AddDayDto } from './dto/add-day.dto';
import type { CreateItineraryDto } from './dto/create-itinerary.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from './dto/itinerary-response.dto';
import type { UpdateDayDto } from './dto/update-day.dto';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ITINERARY_MAX_DAYS } from './itineraries.constants';
import {
  toItineraryDetailResponse,
  toItineraryResponse,
} from './mappers/itinerary.mapper';
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
   * different from the number of days.
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
      { $push: { days: day }, $inc: { dayCount: 1 } },
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

    await itinerary.save();
    return toItineraryDetailResponse(itinerary);
  }

  /** For other services, which need the entity. Never return it from a controller. */
  async findEntityOrThrow(id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries.findById(id);
    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }
    return itinerary;
  }

  /** Loads an itinerary and checks that the caller owns it: 404, then 403. */
  private async findOwnedOrThrow(
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

  /** ITN-05: a day's city comes from the seeded city list (GEN-12). */
  private async assertCityExists(cityId: string): Promise<void> {
    const city = await this.cities.exists({ _id: cityId });
    if (!city) {
      throw new BadRequestException(`Unknown city id: ${cityId}`);
    }
  }

  /** For the admin module (GEN-10): whether an itinerary with this id exists. */
  async existsById(id: string): Promise<boolean> {
    // A count, not exists(): a findOne that matched stalled in local e2e runs
    // against the Atlas test database.
    return (await this.itineraries.countDocuments({ _id: id }).exec()) > 0;
  }

  /**
   * For the admin module (GEN-10): hides an itinerary, or shows it again. Its
   * owner and admins still see a hidden itinerary; reports (GEN-09) and public
   * search (ITN-21, open PR, filters on `moderation`) leave it out for others. One conditional
   * update, so of two admins at the same moment only one changes it. Returns
   * false when nothing changed: the itinerary is missing or already in that
   * state.
   */
  async setHidden(id: string, hidden: boolean): Promise<boolean> {
    const filter = hidden
      ? { _id: id, moderation: { $ne: ItineraryModeration.Hidden } }
      : { _id: id, moderation: ItineraryModeration.Hidden };
    const moderation = hidden
      ? ItineraryModeration.Hidden
      : ItineraryModeration.Visible;
    const itinerary = await this.itineraries
      // Not an edit by the owner, so `updatedAt` ("last changed") stays.
      .findOneAndUpdate(filter, { $set: { moderation } }, { timestamps: false })
      .select('_id')
      .lean()
      .exec();
    return itinerary !== null;
  }

  /**
   * For the admin module (GEN-10): deletes an itinerary, whoever owns it.
   * Returns the file names of its activity images that no other itinerary
   * uses, which the caller deletes, or null when there was no such itinerary.
   * Clones are separate documents and are not touched (as in ITN-01); a clone
   * keeps the image file names of its source (ITN-21), so a file a clone
   * still uses is not returned.
   */
  async removeByAdmin(id: string): Promise<string[] | null> {
    const itinerary = await this.itineraries
      .findByIdAndDelete(id)
      .select('days.activities.images')
      .lean()
      .exec();
    if (!itinerary) {
      return null;
    }
    const images = activityImages(itinerary);
    if (images.length === 0) {
      return [];
    }
    const others = await this.itineraries
      .find({ 'days.activities.images': { $in: images } })
      .select('days.activities.images')
      .lean()
      .exec();
    const stillUsed = new Set(others.flatMap(activityImages));
    return images.filter((image) => !stillUsed.has(image));
  }
}

/** The image file names of every activity of an itinerary, each once. */
function activityImages(itinerary: {
  days?: { activities?: { images?: string[] }[] }[];
}): string[] {
  const names = (itinerary.days ?? []).flatMap((day) =>
    (day.activities ?? []).flatMap((activity) => activity.images ?? []),
  );
  return [...new Set(names)];
}
