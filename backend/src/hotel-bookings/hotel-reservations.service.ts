import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { HotelsService } from '../hotels/hotels.service';
import { todayUtc } from '../hotels/room-dates';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundsService } from '../payments/refunds/refunds.service';
import type {
  HotelReservationDetailsDto,
  HotelReservationListItemDto,
} from './dto/hotel-reservation-response.dto';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { groupFilter, groupOf, groupSort } from './hotel-reservation-groups';
import {
  toHotelReservationDetails,
  toHotelReservationListItem,
} from './mappers/hotel-reservation.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

/**
 * HTL-20: "My hotel reservations" for a registered user. Every query filters
 * by the logged-in user, so a list can never contain someone else's
 * reservation, and a reservation of someone else is the same 404 as one that
 * does not exist (ACC-11).
 */
@Injectable()
export class HotelReservationsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly hotels: HotelsService,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * One page of the user's reservations, of one group or of all three
   * (`hotel-reservation-groups.ts`). The hotel names of the page are read in
   * one query.
   */
  async list(
    userId: string,
    query: HotelReservationsQueryDto,
    today: string = todayUtc(),
  ): Promise<PaginatedResponse<HotelReservationListItemDto>> {
    const filter = {
      userId: new Types.ObjectId(userId),
      ...groupFilter(query.group, today),
    };
    const [page, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort(groupSort(query.group))
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const names = await this.hotels.findNamesByIds(
      page.map((booking) => booking.hotelId),
    );
    const items = page.map((booking) => {
      const group = groupOf(booking, today);
      if (!group) {
        // The filter and groupOf follow the same rule; a mismatch is a bug.
        throw new Error(
          `Reservation ${booking._id.toString()} (${booking.status}) is listed but in no group`,
        );
      }
      return toHotelReservationListItem(
        booking,
        names.get(booking.hotelId.toString()),
        group,
      );
    });
    return paginate(items, total, query);
  }

  /** The full details of the user's own reservation, with its refund (PAY-03). */
  async findOne(
    id: string,
    userId: string,
    today: string = todayUtc(),
  ): Promise<HotelReservationDetailsDto> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    const [names, refund] = await Promise.all([
      this.hotels.findNamesByIds([booking.hotelId]),
      this.refunds.findSummaryByBooking(BookingType.Hotel, id),
    ]);
    return toHotelReservationDetails(
      booking,
      names.get(booking.hotelId.toString()),
      refund,
      today,
    );
  }
}
