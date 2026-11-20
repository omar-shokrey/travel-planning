import type { Types } from 'mongoose';
import type { HotelPublicSummary } from '../../hotels/hotels.service';
import type { PublicItineraryCard } from '../../itineraries/public-itineraries.service';
import { imageUrl } from '../../uploads/uploads.constants';
import type { FavouriteResponseDto } from '../dto/favourite-response.dto';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';
import type { Favourite } from '../models/favourite.schema';

export type FavouriteSource = Pick<
  Favourite,
  'targetType' | 'targetId' | 'createdAt'
> & { _id: Types.ObjectId };

/** The public cards of the targets of one page, by target id. */
export interface FavouriteTargets {
  hotels: ReadonlyMap<string, HotelPublicSummary>;
  itineraries: ReadonlyMap<string, PublicItineraryCard>;
}

/**
 * BON-02: a favourite as its owner sees it. `available` is whether the
 * target's public card was found; without it there is no summary. Never the
 * owner's id, the itinerary's author id or anything about moderation.
 */
export function toFavouriteResponse(
  favourite: FavouriteSource,
  targets: FavouriteTargets,
): FavouriteResponseDto {
  const targetId = favourite.targetId.toString();
  const hotel =
    favourite.targetType === FavouriteTargetType.Hotel
      ? targets.hotels.get(targetId)
      : undefined;
  const itinerary =
    favourite.targetType === FavouriteTargetType.Itinerary
      ? targets.itineraries.get(targetId)
      : undefined;
  return {
    id: favourite._id.toString(),
    targetType: favourite.targetType,
    targetId,
    addedAt: favourite.createdAt.toISOString(),
    available: hotel !== undefined || itinerary !== undefined,
    hotel: hotel
      ? {
          name: hotel.name,
          cityId: hotel.cityId,
          countryCode: hotel.countryCode,
          starClass: hotel.starClass,
          averageRating: hotel.averageRating,
          ratingCount: hotel.ratingCount,
          photoUrl: hotel.firstPhoto ? imageUrl(hotel.firstPhoto) : null,
        }
      : null,
    itinerary: itinerary
      ? {
          title: itinerary.title,
          authorName: itinerary.authorName,
          countries: [...itinerary.countries],
          startDate: itinerary.startDate,
          dayCount: itinerary.dayCount,
        }
      : null,
  };
}
