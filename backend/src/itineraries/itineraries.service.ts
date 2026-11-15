import {
  BadRequestException,
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
import { Country } from '../reference/models/country.schema';
import type { CreateItineraryDto } from './dto/create-itinerary.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { ItineraryResponseDto } from './dto/itinerary-response.dto';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto';
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

  /** ITN-01: edit the title, the countries or the start date of your own itinerary. */
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
}
