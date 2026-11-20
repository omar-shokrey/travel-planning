import { Injectable } from '@nestjs/common';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { UsersService } from '../users/users.service';
import type { ModeratorReservationResponseDto } from './dto/moderator-reservation-response.dto';
import type { ModeratorReservationsQueryDto } from './dto/moderator-reservations-query.dto';
import { HotelBookingLookup } from './hotel-booking-lookup.service';
import { HotelsService } from './hotels.service';
import { toModeratorReservationResponse } from './mappers/moderator-reservation.mapper';

/**
 * HTL-22: a hotel moderator views the reservations of their own hotel
 * (guest, dates, status). The reservations are read through
 * `HotelBookingLookup`, because the hotel-bookings module imports this one
 * and cannot be imported back.
 */
@Injectable()
export class HotelModeratorReservationsService {
  constructor(
    private readonly hotels: HotelsService,
    private readonly lookup: HotelBookingLookup,
    private readonly users: UsersService,
  ) {}

  /**
   * One page of the hotel's reservations. The hotel must be the moderator's
   * own (`findManagedEntityOrThrow`: 404 for a missing hotel, 403 for another
   * hotel's moderator). The guest names of the page are read once per guest.
   */
  async list(
    hotelId: string,
    query: ModeratorReservationsQueryDto,
    userId: string,
  ): Promise<PaginatedResponse<ModeratorReservationResponseDto>> {
    const hotel = await this.hotels.findManagedEntityOrThrow(hotelId, userId);
    const { items, total } = await this.lookup.listForHotel(
      hotel._id,
      query.status,
      { skip: query.skip, limit: query.limit },
    );
    const guestIds = [...new Set(items.map((item) => item.userId.toString()))];
    const guests = await Promise.all(
      guestIds.map((id) => this.users.findEntityById(id)),
    );
    const names = new Map<string, string>();
    guests.forEach((guest, index) => {
      if (guest) names.set(guestIds[index], guest.name);
    });
    return paginate(
      items.map((item) =>
        toModeratorReservationResponse(item, names.get(item.userId.toString())),
      ),
      total,
      query,
    );
  }
}
