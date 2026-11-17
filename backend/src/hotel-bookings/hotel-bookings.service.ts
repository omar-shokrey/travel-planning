import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelsService } from '../hotels/hotels.service';
import { nightCount, todayUtc } from '../hotels/room-dates';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import type { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import type { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { groupFilter, groupSort } from './hotel-booking-groups';
import { HOTEL_BOOKING_HOLD_MINUTES } from './hotel-bookings.constants';
import { toHotelBookingResponse } from './mappers/hotel-booking.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

export const RESERVATION_NOT_FOUND_MESSAGE = 'Reservation not found';
export const NOT_YOUR_RESERVATION_MESSAGE =
  'You can only view your own reservations';

/** HTL-16, HTL-18 and HTL-20: hotel reservations. */
@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
    private readonly hotels: HotelsService,
  ) {}

  /**
   * HTL-16: reserves one or more rooms of one hotel for the same dates, with
   * the guests of each room. HTL-18: going to payment holds all the rooms
   * together for 10 minutes as one Pending Payment reservation; if any room
   * is not free, the whole request is refused and nothing is held.
   *
   * The total is the sum over the rooms of nights x the room's price now.
   * The hotel's times and cancellation tiers are copied, and the moment the
   * user accepted them is stored (PAY-02).
   */
  async create(
    userId: string,
    dto: CreateHotelBookingDto,
  ): Promise<HotelBookingResponseDto> {
    const stay = { from: dto.checkIn, to: dto.checkOut };
    const guests = dto.rooms.map((room) => ({
      roomId: room.roomId,
      adults: room.adults,
      childAges: room.childAges ?? [],
    }));

    const { hotel, rooms } = await this.roomHolds.findBookableRooms(
      dto.hotelId,
      guests.map((room) => ({
        roomId: room.roomId,
        guests: room.adults + room.childAges.length,
      })),
      stay,
    );

    const nights = nightCount(stay);
    const now = new Date();
    const holdExpiresAt = new Date(
      now.getTime() + HOTEL_BOOKING_HOLD_MINUTES * 60 * 1000,
    );
    const bookingId = new Types.ObjectId();

    await this.roomHolds.hold(
      hotel._id,
      rooms.map((room) => room._id),
      stay,
      bookingId,
      holdExpiresAt,
    );

    // `rooms` is in the order of the request, so index i is the same room.
    const bookedRooms = rooms.map((room, index) => ({
      roomId: room._id,
      roomLabel: `${room.number} (${room.type})`,
      pricePerNight: room.pricePerNight,
      adults: guests[index].adults,
      childAges: guests[index].childAges,
    }));

    let booking;
    try {
      booking = await this.bookings.create({
        _id: bookingId,
        userId: new Types.ObjectId(userId),
        hotelId: hotel._id,
        checkIn: stay.from,
        checkOut: stay.to,
        nights,
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt,
        currency: PLATFORM_CURRENCY,
        total: bookedRooms.reduce(
          (sum, room) => sum + room.pricePerNight * nights,
          0,
        ),
        rooms: bookedRooms,
        checkInTime: hotel.policy?.checkInTime,
        checkOutTime: hotel.policy?.checkOutTime,
        cancellationTiers: hotel.policy?.cancellationTiers ?? [],
        policyAcceptedAt: now,
      });
    } catch (error) {
      // Nothing may stay held for a reservation that does not exist.
      await this.roomHolds.release(bookingId);
      throw error;
    }
    return toHotelBookingResponse(booking.toObject(), hotel.name);
  }

  /**
   * HTL-20: one page of the user's own reservations, in one group (Upcoming,
   * Past or Cancelled) or all of them. Nobody else's are ever read.
   */
  async findMine(
    userId: string,
    query: ListHotelBookingsQueryDto,
  ): Promise<PaginatedResponse<HotelBookingResponseDto>> {
    const filter = {
      ...groupFilter(query.group, todayUtc(), new Date()),
      userId: new Types.ObjectId(userId),
    };
    const [bookings, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort(groupSort(query.group))
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);

    const hotelIds = new Map(
      bookings.map((booking) => [booking.hotelId.toString(), booking.hotelId]),
    );
    const names = await this.hotels.findNamesByIds([...hotelIds.values()]);
    const items = bookings.map((booking) =>
      toHotelBookingResponse(
        booking,
        names.get(booking.hotelId.toString()) ?? null,
      ),
    );
    return paginate(items, total, query);
  }

  /**
   * HTL-20: the full details of one of the user's reservations. 404 when it
   * does not exist, 403 when it belongs to someone else (ACC-11).
   */
  async findMineById(
    id: string,
    userId: string,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.bookings.findById(id).lean().exec();
    if (!booking) {
      throw new NotFoundException(RESERVATION_NOT_FOUND_MESSAGE);
    }
    if (booking.userId.toString() !== userId) {
      throw new ForbiddenException(NOT_YOUR_RESERVATION_MESSAGE);
    }
    const names = await this.hotels.findNamesByIds([booking.hotelId]);
    return toHotelBookingResponse(
      booking,
      names.get(booking.hotelId.toString()) ?? null,
    );
  }
}
