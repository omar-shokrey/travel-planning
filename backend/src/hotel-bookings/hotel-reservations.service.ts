import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type QueryFilter } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { HotelsService } from '../hotels/hotels.service';
import { User } from '../users/models/user.schema';
import type { HotelReservationResponseDto } from './dto/hotel-reservation-response.dto';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { toHotelReservationResponse } from './mappers/hotel-reservation.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

/** HTL-22: the reservations of a hotel, for its moderator. */
@Injectable()
export class HotelReservationsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly hotels: HotelsService,
  ) {}

  /**
   * One page of the hotel's reservations, latest check-in first, with the
   * guest's name. Only the moderator assigned to the hotel may read them:
   * 404 for a missing hotel, 403 for anyone else (the HTL-01 rule).
   * Without a status, expired reservations (holds never paid) are left out.
   */
  async findForHotel(
    hotelId: string,
    query: HotelReservationsQueryDto,
    userId: string,
  ): Promise<PaginatedResponse<HotelReservationResponseDto>> {
    const hotel = await this.hotels.findManagedEntityOrThrow(hotelId, userId);

    const filter: QueryFilter<HotelBooking> = {
      hotelId: hotel._id,
      status: query.status ?? { $ne: HotelBookingStatus.Expired },
    };
    const [bookings, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ checkIn: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);

    const names = await this.guestNames(
      bookings.map((booking) => booking.userId),
    );
    const items = bookings.map((booking) =>
      toHotelReservationResponse(
        booking,
        names.get(booking.userId.toString()) ?? null,
      ),
    );
    return paginate(items, total, query);
  }

  /** The names of the guests on one page, in one query. */
  private async guestNames(
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = [...new Map(ids.map((id) => [id.toString(), id])).values()];
    if (unique.length === 0) {
      return new Map();
    }
    const users = await this.users
      .find({ _id: { $in: unique } })
      .select('name')
      .lean()
      .exec();
    return new Map(users.map((user) => [user._id.toString(), user.name]));
  }
}
