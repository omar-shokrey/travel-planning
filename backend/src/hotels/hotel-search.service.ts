import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { HotelSearchResultResponseDto } from './dto/hotel-search-result-response.dto';
import type { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import {
  canHost,
  isFreeForStay,
  nightsOfTheStay,
  roomsThatCanBeFree,
  STAY_NIGHT_FIELDS,
  type SearchNight,
  type SearchRoom,
} from './hotel-search';
import { toHotelSearchResult } from './mappers/hotel-search-result.mapper';
import { Hotel } from './models/hotel.schema';
import { RoomNight } from './models/room-night.schema';
import { Room } from './models/room.schema';
import { assertStay, invalid } from './stay-rules';

/** The hotel fields a search result shows (HTL-11). */
const HOTEL_FIELDS =
  'name addressLine cityId countryCode description photos starClass amenities active ratingCount averageRating createdAt updatedAt';

/**
 * HTL-11: hotel search for guests and users. It reads only; booking (HTL-16)
 * takes rooms in its own concurrency-safe way, so a room listed here can still
 * be gone when the user books it.
 */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNight>,
  ) {}

  /**
   * Active hotels in the city or country with at least `rooms` active rooms
   * free for every night from `checkIn` up to `checkOut` (not included),
   * whose largest `rooms` free rooms together hold `guests`. Sorted by name.
   */
  async search(
    query: SearchHotelsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<HotelSearchResultResponseDto>> {
    const place = this.placeFilter(query);
    const stay = { from: query.checkIn, to: query.checkOut };
    assertStay(stay);

    const hotels = await this.hotels
      .find({ ...place, active: true })
      .select(HOTEL_FIELDS)
      .collation({ locale: 'en' })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    if (hotels.length === 0) return paginate([], 0, query);

    // Only rooms bookable on the first night can be free for the stay; the
    // other nights are checked below.
    const rooms = await this.rooms
      .find({
        hotelId: { $in: hotels.map((hotel) => hotel._id) },
        ...roomsThatCanBeFree(stay),
      })
      .select('hotelId maxOccupancy pricePerNight availability')
      .lean()
      .exec();

    const nights =
      rooms.length === 0
        ? []
        : await this.roomNights
            .find(
              nightsOfTheStay(
                rooms.map((room) => room._id),
                stay,
              ),
            )
            .select(STAY_NIGHT_FIELDS)
            .lean()
            .exec();
    const nightsByRoom = new Map<string, SearchNight[]>();
    for (const night of nights) {
      const key = night.roomId.toString();
      nightsByRoom.set(key, [...(nightsByRoom.get(key) ?? []), night]);
    }

    const freeByHotel = new Map<string, SearchRoom[]>();
    for (const room of rooms) {
      const roomNights = nightsByRoom.get(room._id.toString()) ?? [];
      if (!isFreeForStay(room, stay, roomNights, now)) continue;
      const key = room.hotelId.toString();
      freeByHotel.set(key, [...(freeByHotel.get(key) ?? []), room]);
    }

    const matches = hotels.flatMap((hotel) => {
      const free = freeByHotel.get(hotel._id.toString()) ?? [];
      return canHost(free, query.rooms, query.guests)
        ? [toHotelSearchResult(hotel, free)]
        : [];
    });
    return paginate(
      matches.slice(query.skip, query.skip + query.limit),
      matches.length,
      query,
    );
  }

  /** Exactly one of city and country (HTL-11 searches "by city or country"). */
  private placeFilter(
    query: SearchHotelsQueryDto,
  ): { cityId: string } | { countryCode: string } {
    if (query.cityId !== undefined && query.countryCode !== undefined) {
      throw invalid('cityId', 'Give cityId or countryCode, not both');
    }
    if (query.cityId !== undefined) return { cityId: query.cityId };
    if (query.countryCode !== undefined) {
      return { countryCode: query.countryCode };
    }
    throw invalid('cityId', 'Give cityId or countryCode');
  }
}
