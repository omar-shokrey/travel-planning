import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { HotelSearchResultResponseDto } from '../dto/hotel-search-result-response.dto';
import type { SearchRoom } from '../hotel-search';
import { type HotelSource, toHotelResponse } from './hotel.mapper';

/**
 * HTL-11: a hotel in the search results, with how many rooms are free for the
 * stay and the lowest price per night among them. `freeRooms` is never
 * empty: only hotels that can take the search are listed.
 */
export function toHotelSearchResult(
  hotel: HotelSource,
  freeRooms: readonly SearchRoom[],
): HotelSearchResultResponseDto {
  return {
    ...toHotelResponse(hotel),
    freeRooms: freeRooms.length,
    lowestPricePerNight: Math.min(
      ...freeRooms.map((room) => room.pricePerNight),
    ),
    currency: PLATFORM_CURRENCY,
  };
}
