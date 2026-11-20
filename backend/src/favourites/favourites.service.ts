import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import {
  type HotelPublicSummary,
  HotelsService,
} from '../hotels/hotels.service';
import {
  type PublicItineraryCard,
  PublicItinerariesService,
} from '../itineraries/public-itineraries.service';
import type { AddFavouriteDto } from './dto/add-favourite.dto';
import type { FavouriteResponseDto } from './dto/favourite-response.dto';
import type { ListFavouritesQueryDto } from './dto/list-favourites-query.dto';
import { FavouriteTargetType } from './enums/favourite-target-type.enum';
import {
  FAVOURITE_HOTEL_NOT_FOUND_MESSAGE,
  FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
  FAVOURITE_NOT_FOUND_MESSAGE,
  FAVOURITES_LIMIT_MESSAGE,
  FAVOURITES_MAX_PER_USER,
} from './favourites.constants';
import {
  type FavouriteSource,
  type FavouriteTargets,
  toFavouriteResponse,
} from './mappers/favourite.mapper';
import { Favourite } from './models/favourite.schema';

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/** What an add gives the controller: the favourite and whether it is new (201) or was there (200). */
export interface AddFavouriteResult {
  favourite: FavouriteResponseDto;
  created: boolean;
}

/**
 * BON-02: a registered user saves hotels and public itineraries and lists
 * them. Every query has the logged-in user in its filter, so nobody reads or
 * deletes another user's favourites. The targets' public cards come from the
 * hotels and itineraries modules, one query per type for a whole page.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name)
    private readonly favourites: Model<Favourite>,
    private readonly hotels: HotelsService,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  /**
   * POST /api/favourites. The target must be visible to the public now: an
   * active hotel, or a public itinerary that is not hidden and whose author
   * is not deactivated (the rule of ITN-21); anything else is 404, so a
   * private itinerary is never confirmed to exist. Saving the same target
   * again is idempotent: the existing favourite comes back with
   * `created: false`. The save is one atomic upsert; the unique index decides
   * two adds at the same moment, and the loser reads the winner's favourite.
   */
  async add(userId: string, dto: AddFavouriteDto): Promise<AddFavouriteResult> {
    // One form of the id from here on: the DTO accepts upper-case hex, the
    // maps of the cards are keyed by the lower-case `toString()`.
    const targetId = new Types.ObjectId(dto.targetId);
    const targets = await this.targetsOf([
      { targetType: dto.targetType, targetId },
    ]);
    if (!this.isAvailable(dto.targetType, targetId.toString(), targets)) {
      throw new NotFoundException(
        dto.targetType === FavouriteTargetType.Hotel
          ? FAVOURITE_HOTEL_NOT_FOUND_MESSAGE
          : FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
      );
    }

    const owner = new Types.ObjectId(userId);
    const key = { userId: owner, targetType: dto.targetType, targetId };
    const existing = await this.findByKey(key);
    if (existing) {
      return {
        favourite: toFavouriteResponse(existing, targets),
        created: false,
      };
    }
    if (
      (await this.favourites.countDocuments({ userId: owner }).exec()) >=
      FAVOURITES_MAX_PER_USER
    ) {
      // The same add at the same moment may have saved it in between: it is
      // a repeat then (200), not one too many.
      const savedMeanwhile = await this.findByKey(key);
      if (savedMeanwhile) {
        return {
          favourite: toFavouriteResponse(savedMeanwhile, targets),
          created: false,
        };
      }
      throw new ConflictException(FAVOURITES_LIMIT_MESSAGE);
    }

    try {
      // One atomic upsert that returns the favourite and whether it was
      // there already.
      const result = await this.favourites
        .findOneAndUpdate(
          key,
          { $setOnInsert: key },
          {
            upsert: true,
            returnDocument: 'after',
            includeResultMetadata: true,
            lean: true,
          },
        )
        .exec();
      const saved = result.value as FavouriteSource | null;
      if (saved) {
        return {
          favourite: toFavouriteResponse(saved, targets),
          created: result.lastErrorObject?.updatedExisting !== true,
        };
      }
    } catch (error) {
      // Two adds of the same target at the same moment: both upserts insert,
      // the unique index refuses the second. Its caller gets the first.
      if (!isDuplicateKey(error)) {
        throw error;
      }
    }
    const winner = await this.findByKey(key);
    if (!winner) {
      // The winner's favourite was removed by its owner in between.
      throw new NotFoundException(FAVOURITE_NOT_FOUND_MESSAGE);
    }
    return { favourite: toFavouriteResponse(winner, targets), created: false };
  }

  /**
   * GET /api/favourites: one page of the user's favourites, newest first
   * (`_id` breaks ties), optionally of one type. A target that is no longer
   * public stays in the list with `available: false`, so pages and `total`
   * stay right and the user can remove it.
   */
  async list(
    userId: string,
    query: ListFavouritesQueryDto,
  ): Promise<PaginatedResponse<FavouriteResponseDto>> {
    const filter = {
      userId: new Types.ObjectId(userId),
      ...(query.targetType ? { targetType: query.targetType } : {}),
    };
    const [page, total] = await Promise.all([
      this.favourites
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean<FavouriteSource[]>()
        .exec(),
      this.favourites.countDocuments(filter).exec(),
    ]);
    const targets = await this.targetsOf(page);
    return paginate(
      page.map((favourite) => toFavouriteResponse(favourite, targets)),
      total,
      query,
    );
  }

  /** DELETE /api/favourites/:id: the user's own favourite only; any other is the same 404. */
  async remove(id: string, userId: string): Promise<void> {
    const deleted = await this.favourites
      .findOneAndDelete({ _id: id, userId: new Types.ObjectId(userId) })
      .select('_id')
      .lean()
      .exec();
    if (!deleted) {
      throw new NotFoundException(FAVOURITE_NOT_FOUND_MESSAGE);
    }
  }

  private findByKey(key: {
    userId: Types.ObjectId;
    targetType: FavouriteTargetType;
    targetId: Types.ObjectId;
  }): Promise<FavouriteSource | null> {
    return this.favourites
      .findOne(key)
      .select('targetType targetId createdAt')
      .lean<FavouriteSource>()
      .exec();
  }

  /** The public cards of these targets: one query per type, none for a type with no target. */
  private async targetsOf(
    favourites: readonly {
      targetType: FavouriteTargetType;
      targetId: Types.ObjectId | string;
    }[],
  ): Promise<FavouriteTargets> {
    const idsOf = (type: FavouriteTargetType) =>
      favourites
        .filter((favourite) => favourite.targetType === type)
        .map((favourite) => favourite.targetId.toString());
    const hotelIds = idsOf(FavouriteTargetType.Hotel);
    const itineraryIds = idsOf(FavouriteTargetType.Itinerary);
    const [hotels, itineraries] = await Promise.all([
      hotelIds.length > 0
        ? this.hotels.findPublicSummaries(hotelIds)
        : new Map<string, HotelPublicSummary>(),
      itineraryIds.length > 0
        ? this.publicItineraries.findPublicCards(itineraryIds)
        : new Map<string, PublicItineraryCard>(),
    ]);
    return { hotels, itineraries };
  }

  private isAvailable(
    targetType: FavouriteTargetType,
    targetId: string,
    targets: FavouriteTargets,
  ): boolean {
    return targetType === FavouriteTargetType.Hotel
      ? targets.hotels.has(targetId)
      : targets.itineraries.has(targetId);
  }
}
