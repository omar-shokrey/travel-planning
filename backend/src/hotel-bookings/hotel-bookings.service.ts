import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { nightCount } from '../hotels/room-dates';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import type { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingConfirmationService } from './hotel-booking-confirmation.service';
import { HOTEL_BOOKING_HOLD_MINUTES } from './hotel-bookings.constants';
import {
  type HotelBookingSource,
  toHotelBookingResponse,
} from './mappers/hotel-booking.mapper';
import { HotelBooking } from './models/hotel-booking.schema';

/** PAY-02: a booking that does not exist or is not the caller's (ACC-11). */
export const BOOKING_NOT_FOUND_MESSAGE = 'Booking not found';

/** HTL-16 and HTL-18: hotel reservations. */
@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly roomHolds: HotelRoomHoldsService,
    // HTL-17: what happens once the payment succeeded.
    private readonly confirmation: HotelBookingConfirmationService,
  ) {}

  /**
   * HTL-17: the `BookingPaymentHandler` of PAY-01. The payments webhook calls
   * it once Stripe reports the money arrived; `PaymentsModule` finds it on
   * this service. See `HotelBookingConfirmationService.confirmPaid`: one
   * conditional update to `confirmed` while the hold is live, all the rooms
   * together, idempotent, `false` for a late payment.
   */
  confirmPaid(bookingId: string, now: Date): Promise<boolean> {
    return this.confirmation.confirmPaid(bookingId, now);
  }

  /**
   * HTL-16: reserves one or more rooms of one hotel for the same dates, with
   * the guests of each room. HTL-18: going to payment holds all the rooms
   * together for 10 minutes as one Pending Payment reservation; if any room
   * is not free, the whole request is refused and nothing is held.
   *
   * The total is the sum over the rooms of nights x the room's price now.
   * The hotel's times and cancellation tiers are copied, so a later change by
   * the hotel does not change this reservation.
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
    const holdExpiresAt = new Date(
      Date.now() + HOTEL_BOOKING_HOLD_MINUTES * 60 * 1000,
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
        // Whole minor units times whole nights: always a whole number.
        total: bookedRooms.reduce(
          (sum, room) => sum + room.pricePerNight * nights,
          0,
        ),
        rooms: bookedRooms,
        checkInTime: hotel.policy?.checkInTime,
        checkOutTime: hotel.policy?.checkOutTime,
        cancellationTiers: hotel.policy?.cancellationTiers ?? [],
      });
    } catch (error) {
      // Nothing may stay held for a reservation that does not exist.
      await this.roomHolds.release(bookingId);
      throw error;
    }
    return toHotelBookingResponse(booking.toObject());
  }

  /**
   * PAY-02: the user's own reservation as stored, for the payments module (never
   * through a controller). 404 "Booking not found" when it does not exist or
   * belongs to another user, so a user never learns that someone else's
   * booking exists (ACC-11).
   */
  async findOwnedEntityOrThrow(
    id: string,
    userId: string,
  ): Promise<HotelBookingSource> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    return booking;
  }

  /**
   * PAY-02: records that the user accepted the policies, with one
   * conditional update: only the user's own reservation, still waiting for
   * payment, whose hold has not ended at `now` and that was not accepted
   * before, so the first timestamp is never moved. Returns the reservation
   * after the change, or `null` when nothing matched (the caller reads it
   * to say why).
   */
  acceptPolicies(
    id: string,
    userId: string,
    now: Date,
  ): Promise<HotelBookingSource | null> {
    return this.bookings
      .findOneAndUpdate(
        {
          _id: id,
          userId: new Types.ObjectId(userId),
          status: HotelBookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
          policyAcceptedAt: { $exists: false },
        },
        { $set: { policyAcceptedAt: now } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
  }

  /**
   * ACC-12: whether the user has a confirmed reservation, for the
   * deactivation of their own account (never through a controller). The
   * completion job (GEN-11) moves a reservation to `completed` once its stay
   * is over, so a reservation that is still `confirmed` is upcoming. Read
   * only.
   */
  async hasConfirmedBooking(userId: string): Promise<boolean> {
    // A count with a limit of 1, not exists(): a findOne that matched stalled
    // in local e2e runs against the Atlas test database (see PostsService).
    const found = await this.bookings
      .countDocuments(
        {
          userId: new Types.ObjectId(userId),
          status: HotelBookingStatus.Confirmed,
        },
        { limit: 1 },
      )
      .exec();
    return found > 0;
  }

  /**
   * ACC-12: whether the user has a reservation waiting for payment whose
   * hold has not ended at `now`, for the deactivation of their own account
   * (never through a controller). A payment inside the hold would confirm
   * it. An ended hold does not count: the payment is late and is refunded
   * (PAY-03). Read only.
   */
  async hasLiveHold(userId: string, now: Date): Promise<boolean> {
    // A count with a limit of 1, not exists(): a findOne that matched stalled
    // in local e2e runs against the Atlas test database (see PostsService).
    const found = await this.bookings
      .countDocuments(
        {
          userId: new Types.ObjectId(userId),
          status: HotelBookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
        },
        { limit: 1 },
      )
      .exec();
    return found > 0;
  }

  /**
   * ACC-15: the travellers to tell when the admin deactivates this hotel,
   * for the admin module (never through a controller). The users with a
   * confirmed reservation of this hotel that is not over yet: its check-out
   * is today or later, today being the UTC date of `now` (`YYYY-MM-DD`
   * strings compare in date order). Each user once. Read only.
   */
  findTravellerIdsOfHotel(
    hotelId: Types.ObjectId,
    now: Date,
  ): Promise<Types.ObjectId[]> {
    const today = now.toISOString().slice(0, 10);
    return this.bookings
      .distinct('userId', {
        hotelId,
        status: HotelBookingStatus.Confirmed,
        checkOut: { $gte: today },
      })
      .exec();
  }
}
