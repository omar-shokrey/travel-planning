import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { HotelSearchResultResponseDto } from './dto/hotel-search-result-response.dto';
import type { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { canHost } from './hotel-search';
import { toHotelSearchResultResponse } from './mappers/hotel-search-result.mapper';
import { Hotel } from './models/hotel.schema';

/** HTL-11: hotel search for guests and users. */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly availableRooms: HotelAvailableRoomsService,
  ) {}

  /**
   * HTL-11: the active hotels of the city or country that have at least
   * `rooms` rooms free for the whole stay, whose combined maximum occupancy
   * covers `guests`. Sorted by hotel name, one page at a time.
   */
  async search(
    query: SearchHotelsQueryDto,
  ): Promise<PaginatedResponse<HotelSearchResultResponseDto>> {
    const stay = { from: query.checkIn, to: query.checkOut };
    this.availableRooms.assertStay(stay);

    // The DTO lets exactly one of the two through.
    const destination =
      query.cityId !== undefined
        ? { cityId: query.cityId }
        : { countryCode: query.countryCode };

    const hotels = await this.hotels
      .find({ ...destination, active: true })
      .select(
        'name addressLine cityId countryCode starClass amenities photos averageRating ratingCount',
      )
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();

    const freeByHotel = await this.availableRooms.findFreeRoomsOfHotels(
      hotels.map((hotel) => hotel._id),
      stay,
    );

    const matches = hotels.flatMap((hotel) => {
      const free = freeByHotel.get(hotel._id.toString()) ?? [];
      return canHost(free, query.rooms, query.guests) ? [{ hotel, free }] : [];
    });

    const items = matches
      .slice(query.skip, query.skip + query.limit)
      .map(({ hotel, free }) => toHotelSearchResultResponse(hotel, free));

    return paginate(items, matches.length, query);
  }
}
