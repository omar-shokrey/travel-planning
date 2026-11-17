import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { HotelResponseDto } from './dto/hotel-response.dto';
import { toHotelResponse } from './mappers/hotel.mapper';
import { Hotel } from './models/hotel.schema';

/** What guests and users see of a hotel (HTL-02). */
@Injectable()
export class HotelDetailsService {
  constructor(@InjectModel(Hotel.name) private readonly hotels: Model<Hotel>) {}

  /**
   * HTL-02: the hotel page. A deactivated hotel is hidden from the public
   * (ACC-15), so it answers 404 like a hotel that does not exist.
   */
  async findActiveById(id: string): Promise<HotelResponseDto> {
    const hotel = await this.hotels.findOne({ _id: id, active: true }).exec();

    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    return toHotelResponse(hotel);
  }
}
