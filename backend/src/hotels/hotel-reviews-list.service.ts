import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UsersService } from '../users/users.service';
import type { HotelReviewResponseDto } from './dto/hotel-review-response.dto';
import { HotelReviewLookup } from './hotel-review-lookup.service';
import { toHotelReviewResponse } from './mappers/hotel-review.mapper';
import { Hotel } from './models/hotel.schema';

/**
 * HTL-24: the public reviews of a hotel, newest first, paginated. The
 * average rating and the number of ratings are on the hotel page (HTL-02).
 */
@Injectable()
export class HotelReviewsListService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly reviews: HotelReviewLookup,
    private readonly users: UsersService,
  ) {}

  /**
   * One page of the visible reviews of an active hotel. A missing or
   * deactivated hotel (ACC-15) answers 404, as the hotel page does. The
   * authors' names of the page are read in one query.
   */
  async list(
    hotelId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<HotelReviewResponseDto>> {
    const id = new Types.ObjectId(hotelId);
    const hotel = await this.hotels.exists({ _id: id, active: true }).exec();
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }
    const { items, total } = await this.reviews.listVisibleForHotel(id, {
      skip: query.skip,
      limit: query.limit,
    });
    const names = await this.users.findNamesByIds(
      items.map((review) => review.userId),
    );
    return paginate(
      items.map((review) => toHotelReviewResponse(review, names)),
      total,
      query,
    );
  }
}
