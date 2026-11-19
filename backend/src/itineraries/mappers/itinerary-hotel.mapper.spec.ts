import type { HotelSearchResultResponseDto } from '../../hotels/dto/hotel-search-result-response.dto';
import { toItineraryHotelResponse } from './itinerary-hotel.mapper';

const hotel = {
  id: '6740f1c2a4b5c6d7e8f90123',
  name: 'Nile View',
  cityId: 'cairo',
  freeRooms: 3,
  lowestPricePerNight: 9500,
  currency: 'USD',
} as HotelSearchResultResponseDto;

describe('toItineraryHotelResponse (ITN-25)', () => {
  it('keeps every field of the search result and adds the searched stay', () => {
    expect(
      toItineraryHotelResponse(hotel, {
        checkIn: '2026-12-20',
        checkOut: '2026-12-23',
      }),
    ).toEqual({ ...hotel, checkIn: '2026-12-20', checkOut: '2026-12-23' });
  });

  it('does not change the search result it was given', () => {
    const before = { ...hotel };

    toItineraryHotelResponse(hotel, {
      checkIn: '2026-12-20',
      checkOut: '2026-12-23',
    });

    expect(hotel).toEqual(before);
  });
});
