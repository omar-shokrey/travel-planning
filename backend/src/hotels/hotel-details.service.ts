import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { HotelDetailsQueryDto } from './dto/hotel-details-query.dto';
import type { HotelDetailsResponseDto } from './dto/hotel-details-response.dto';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { toHotelDetailsResponse } from './mappers/hotel-policy.mapper';
import { Hotel } from './models/hotel.schema';
import { assertStay } from './stay-rules';

/** What guests and users see of a hotel (HTL-02). */
@Injectable()
export class HotelDetailsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly availableRooms: HotelAvailableRoomsService,
  ) {}

  /**
   * HTL-02: the hotel page. A deactivated hotel is hidden from the public
   * (ACC-15), so it answers 404 like a hotel that does not exist. With a
   * check-in and a check-out date, the page also lists every room that is
   * free for the whole stay (HTL-15), with the same rule and the same stay
   * checks as `GET /api/hotels/:id/rooms/available`.
   */
  async findActiveById(
    id: string,
    query: HotelDetailsQueryDto = {},
    now: Date = new Date(),
  ): Promise<HotelDetailsResponseDto> {
    const stay =
      query.checkIn !== undefined && query.checkOut !== undefined
        ? { from: query.checkIn, to: query.checkOut }
        : null;
    if (stay) {
      assertStay(stay);
    }

    const hotel = await this.hotels.findOne({ _id: id, active: true }).exec();

    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    const rooms = stay
      ? await this.availableRooms.listAvailable(hotel._id, stay, now)
      : null;

    return toHotelDetailsResponse(hotel, rooms);
  }
}
