import type { HotelSearchResultResponseDto } from '../../hotels/dto/hotel-search-result-response.dto';
import type { ItineraryHotelResponseDto } from '../dto/itinerary-hotel-response.dto';

/** The stay of a city group, as two `YYYY-MM-DD` dates. */
export interface GroupStay {
  checkIn: string;
  checkOut: string;
}

/**
 * ITN-25: a hotel result of hotel search (HTL-11) together with the stay it
 * was searched for. Plain function: no database and no HTTP.
 */
export function toItineraryHotelResponse(
  hotel: HotelSearchResultResponseDto,
  stay: GroupStay,
): ItineraryHotelResponseDto {
  return { ...hotel, checkIn: stay.checkIn, checkOut: stay.checkOut };
}
