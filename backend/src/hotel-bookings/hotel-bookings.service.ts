import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { nightCount } from '../hotels/room-dates';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import type { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HOTEL_BOOKING_HOLD_MINUTES } from './hotel-bookings.constants';
import { toHotelBookingResponse } from './mappers/hotel-booking.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

/** HTL-16 and HTL-18: hotel reservations. */
@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
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
    return toHotelBookingResponse(booking.toObject());
  }
}
