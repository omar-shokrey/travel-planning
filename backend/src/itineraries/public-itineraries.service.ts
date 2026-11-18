import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type QueryFilter } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { User } from '../users/models/user.schema';
import type { AuthorResponseDto } from './dto/author-response.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type {
  PublicItineraryDetailResponseDto,
  PublicItineraryResponseDto,
} from './dto/public-itinerary-response.dto';
import type { SearchPublicItinerariesQueryDto } from './dto/search-public-itineraries-query.dto';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './enums/itinerary-visibility.enum';
import {
  toItineraryDetailResponse,
  toItineraryResponse,
} from './mappers/itinerary.mapper';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

/** Shown when an author's account cannot be found. */
export const UNKNOWN_AUTHOR = 'Unknown author';

/**
 * What makes an itinerary visible to everyone: public (ITN-20), not hidden by
 * an admin (GEN-10) and its author's account not deactivated (ACC-12).
 */
export const PUBLICLY_VISIBLE = {
  visibility: ItineraryVisibility.Public,
  moderation: ItineraryModeration.Visible,
  authorDeactivated: false,
} as const;

/** Escapes a keyword so it is matched as plain text, never as a pattern. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ITN-21: public itineraries for guests and users: search, read-only view and clone. */
@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  /**
   * ITN-21: search public itineraries by keyword (title, country or city) and
   * filter by duration, country or city. Most recently updated first. An
   * itinerary made private leaves the results at once (ITN-20).
   */
  async search(
    query: SearchPublicItinerariesQueryDto,
  ): Promise<PaginatedResponse<PublicItineraryResponseDto>> {
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    ) {
      throw new BadRequestException('minDays must not be greater than maxDays');
    }

    const filter: QueryFilter<Itinerary> = { ...PUBLICLY_VISIBLE };
    if (query.minDays !== undefined || query.maxDays !== undefined) {
      filter.dayCount = {
        ...(query.minDays !== undefined ? { $gte: query.minDays } : {}),
        ...(query.maxDays !== undefined ? { $lte: query.maxDays } : {}),
      };
    }
    if (query.country) filter.countries = query.country;
    if (query.city) filter['days.cityId'] = query.city;
    if (query.q) filter.$or = await this.keywordConditions(query.q);

    return this.listPublic(filter, query);
  }

  /**
   * The publicly visible itineraries of one author, most recently updated
   * first, with the same rows as the search. It serves the blog's public
   * author page (BLG-12); no itineraries route uses it. An itinerary made
   * private leaves the list at once (ITN-20). The (ownerId, updatedAt) index
   * serves the query.
   */
  listByAuthor(
    authorId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PublicItineraryResponseDto>> {
    return this.listPublic(
      { ...PUBLICLY_VISIBLE, ownerId: new Types.ObjectId(authorId) },
      query,
    );
  }

  /** ITN-21: a public itinerary, read-only, with its author, days, activities and budget. */
  async findPublic(id: string): Promise<PublicItineraryDetailResponseDto> {
    const itinerary = await this.findPublicOrThrow(id);
    const authors = await this.authorsOf([itinerary]);
    return {
      ...toItineraryDetailResponse(itinerary),
      author: this.authorOf(itinerary, authors),
    };
  }

  /**
   * ITN-21: copy a public itinerary for the logged-in user. The clone has all
   * days, activities, budget entries and transport costs with new ids, is
   * private, credits the original author, and shares nothing with the
   * original, so later changes or a delete of either leave the other alone.
   */
  async clone(id: string, userId: string): Promise<ItineraryDetailResponseDto> {
    const source = await this.findPublicOrThrow(id);
    const authors = await this.authorsOf([source]);

    const clone = await this.itineraries.create({
      ownerId: new Types.ObjectId(userId),
      title: source.title,
      countries: [...source.countries],
      startDate: source.startDate,
      days: source.days.map((day) => ({
        cityId: day.cityId,
        ...(day.notes ? { notes: day.notes } : {}),
        activities: day.activities.map((activity) => ({
          name: activity.name,
          description: activity.description,
          time: activity.time,
          cost: activity.cost,
          currency: activity.currency,
          images: [...activity.images],
        })),
        budgetEntries: day.budgetEntries.map((entry) => ({
          category: entry.category,
          amount: entry.amount,
          currency: entry.currency,
        })),
        transportCosts: day.transportCosts.map((cost) => ({
          mode: cost.mode,
          fromCityId: cost.fromCityId,
          toCityId: cost.toCityId,
          amount: cost.amount,
          currency: cost.currency,
        })),
      })),
      dayCount: source.days.length,
      cloneSource: {
        itineraryId: source._id,
        authorId: source.ownerId,
        authorName: this.authorOf(source, authors).name,
      },
    });
    return toItineraryDetailResponse(clone);
  }

  /**
   * One page of the itineraries that match `filter`, without their days, most
   * recently updated first (then by id, so a page never shifts), each with its
   * author. The filter must include `PUBLICLY_VISIBLE`.
   */
  private async listPublic(
    filter: QueryFilter<Itinerary>,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PublicItineraryResponseDto>> {
    const [found, total] = await Promise.all([
      this.itineraries
        .find(filter)
        .select('-days')
        .sort({ updatedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit),
      this.itineraries.countDocuments(filter),
    ]);
    const authors = await this.authorsOf(found);
    return paginate(
      found.map((itinerary) => ({
        ...toItineraryResponse(itinerary),
        author: this.authorOf(itinerary, authors),
      })),
      total,
      query,
    );
  }

  /** A publicly visible itinerary, or 404: a private or hidden one is not revealed. */
  private async findPublicOrThrow(id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries.findOne({
      _id: id,
      ...PUBLICLY_VISIBLE,
    });
    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }
    return itinerary;
  }

  /** The keyword matches part of the title, a country code or name, or a city name. */
  private async keywordConditions(
    keyword: string,
  ): Promise<QueryFilter<Itinerary>[]> {
    // The `$regex` string form, not a RegExp object. Both mean the same to
    // MongoDB, but in local runs against the Atlas test database a query
    // with a RegExp object and the `i` flag inside `$or` sometimes never got
    // an answer (the connection was then reset), while the string form always
    // did. ACC-14's account search uses the same form for the same reason.
    const pattern = { $regex: escapeRegExp(keyword), $options: 'i' };
    const [countries, cities] = await Promise.all([
      this.countries
        .find({ $or: [{ _id: keyword.toUpperCase() }, { name: pattern }] })
        .select('_id')
        .lean(),
      this.cities.find({ name: pattern }).select('_id').lean(),
    ]);
    const conditions: QueryFilter<Itinerary>[] = [{ title: pattern }];
    if (countries.length > 0) {
      conditions.push({ countries: { $in: countries.map((c) => c._id) } });
    }
    if (cities.length > 0) {
      conditions.push({ 'days.cityId': { $in: cities.map((c) => c._id) } });
    }
    return conditions;
  }

  /** The names of the owners of these itineraries, by user id. */
  private async authorsOf(
    itineraries: ItineraryDocument[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(itineraries.map((itinerary) => itinerary.ownerId.toString())),
    ];
    if (ids.length === 0) return new Map();
    const users = await this.users
      .find({ _id: { $in: ids } })
      .select('name')
      .lean();
    return new Map(users.map((user) => [user._id.toString(), user.name]));
  }

  private authorOf(
    itinerary: ItineraryDocument,
    authors: Map<string, string>,
  ): AuthorResponseDto {
    const id = itinerary.ownerId.toString();
    return { id, name: authors.get(id) ?? UNKNOWN_AUTHOR };
  }
}
