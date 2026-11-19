import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { SearchHotelsQueryDto } from '../hotels/dto/search-hotels-query.dto';
import { HotelSearchService } from '../hotels/hotel-search.service';
import type { ItineraryHotelResponseDto } from './dto/itinerary-hotel-response.dto';
import type { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import { ItinerariesService } from './itineraries.service';
import {
  type GroupStay,
  toItineraryHotelResponse,
} from './mappers/itinerary-hotel.mapper';
import { dayDate, toCityGroups } from './mappers/itinerary.mapper';

/**
 * ITN-25: the hotels that are free for a city group of the itinerary. The
 * group gives the city and the stay; the user gives the guests and the rooms;
 * hotel search (HTL-11) answers, so the free-room rule is the one of the hotels
 * module and the two cannot disagree. Reads only.
 */
@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly hotelSearch: HotelSearchService,
  ) {}

  /**
   * Hotels in the city of the group with enough rooms free for every night
   * from its first day to the day after its last, sorted by name. 404 when the
   * itinerary does not exist or no group starts on that day, 403 when it is not
   * the caller's, 400 when the group starts in the past. `now` is for tests.
   */
  async search(
    itineraryId: string,
    query: ItineraryHotelsQueryDto,
    userId: string,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<ItineraryHotelResponseDto>> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
      'You can only search hotels for your own itineraries',
    );
    // The same groups the owner sees in `cityGroups` (ITN-09), so the number
    // the client sends is one it was given.
    const group = toCityGroups(itinerary.days, itinerary.startDate).find(
      (candidate) => candidate.firstDayNumber === query.firstDayNumber,
    );
    if (!group) {
      throw new NotFoundException('City group not found');
    }

    // Check-in is the first day of the group, check-out the day after its
    // last day (ITN-25). Both are dates without a time, added in UTC.
    const stay: GroupStay = {
      checkIn: group.startDate,
      checkOut: dayDate(group.endDate, 1),
    };
    const today = DateTime.fromJSDate(now, { zone: 'utc' }).toFormat(
      'yyyy-MM-dd',
    );
    if (stay.checkIn < today) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: [
          {
            field: 'firstDayNumber',
            messages: [
              'This city group starts in the past. Hotels can be searched only for a stay that starts today (UTC) or later',
            ],
          },
        ],
      });
    }

    const hotelQuery = Object.assign(new SearchHotelsQueryDto(), {
      cityId: group.cityId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      guests: query.guests,
      rooms: query.rooms,
      page: query.page,
      limit: query.limit,
    });
    const found = await this.hotelSearch.search(hotelQuery, now);
    return {
      items: found.items.map((hotel) => toItineraryHotelResponse(hotel, stay)),
      meta: found.meta,
    };
  }
}
