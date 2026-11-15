import type { ItineraryResponseDto } from '../dto/itinerary-response.dto';
import type { ItineraryDocument } from '../models/itinerary.schema';

/** Turns a stored itinerary into what the API returns. */
export function toItineraryResponse(
  itinerary: ItineraryDocument,
): ItineraryResponseDto {
  return {
    id: itinerary._id.toString(),
    ownerId: itinerary.ownerId.toString(),
    title: itinerary.title,
    countries: [...itinerary.countries],
    startDate: itinerary.startDate,
    visibility: itinerary.visibility,
    dayCount: itinerary.dayCount,
  };
}
