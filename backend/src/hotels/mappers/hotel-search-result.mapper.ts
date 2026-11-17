import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { imageUrl } from '../../uploads/uploads.constants';
import type { HotelSearchResultResponseDto } from '../dto/hotel-search-result-response.dto';
import { cheapestPricePerNight, type SearchRoom } from '../hotel-search';
import type { Hotel } from '../models/hotel.schema';

export type HotelSearchSource = Pick<
  Hotel,
  | 'name'
  | 'addressLine'
  | 'cityId'
  | 'countryCode'
  | 'starClass'
  | 'amenities'
  | 'photos'
  | 'averageRating'
  | 'ratingCount'
> & { _id: Types.ObjectId };

/** HTL-11: a hotel that can host the search, with its free rooms summed up. */
export function toHotelSearchResultResponse(
  hotel: HotelSearchSource,
  freeRooms: readonly SearchRoom[],
): HotelSearchResultResponseDto {
  return {
    id: hotel._id.toString(),
    name: hotel.name,
    addressLine: hotel.addressLine,
    cityId: hotel.cityId,
    countryCode: hotel.countryCode,
    starClass: hotel.starClass,
    amenities: hotel.amenities,
    photos: hotel.photos.map((filename) => ({
      filename,
      url: imageUrl(filename),
    })),
    averageRating: hotel.averageRating,
    ratingCount: hotel.ratingCount,
    freeRooms: freeRooms.length,
    cheapestPricePerNight: cheapestPricePerNight(freeRooms),
    currency: PLATFORM_CURRENCY,
  };
}
