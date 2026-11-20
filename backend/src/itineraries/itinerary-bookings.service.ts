import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingStatus } from '../hotel-bookings/enums/hotel-booking-status.enum';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { LinkBookingDto } from './dto/link-booking.dto';
import { LinkedBookingType } from './enums/linked-booking-type.enum';
import {
  BOOKING_ALREADY_LINKED_MESSAGE,
  BOOKING_NOT_LINKABLE_MESSAGE,
  ITINERARY_CHANGED_MESSAGE,
  LINKED_BOOKINGS_PER_DAY_MAX,
  LINKED_BOOKINGS_PER_DAY_MESSAGE,
} from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

/**
 * How many times a link reads the itinerary again after another change won
 * the race, before it answers 409 (the same rule as a budget entry, ITN-14).
 */
const LINK_ATTEMPTS_MAX = 5;

/** What a link copies from a booking (DESIGN: a snapshot, never re-read). */
interface BookingCopy {
  bookingType: LinkedBookingType;
  bookingId: Types.ObjectId;
  reference: string;
  amount: number;
  currency: string;
}

/**
 * The statuses of a booking that may be linked: paid, whether the trip is
 * still ahead or over. Pending payment, expired and cancelled may not.
 */
const LINKABLE_STATUSES: ReadonlySet<string> = new Set([
  FlightBookingStatus.Confirmed,
  FlightBookingStatus.Completed,
  HotelBookingStatus.Confirmed,
  HotelBookingStatus.Completed,
]);

/**
 * ITN-27 (bonus): link a booked flight or hotel to a day of an itinerary, so
 * it counts in the budget. The link is embedded in the day and keeps a copy
 * of the booking's reference, total and currency.
 */
@Injectable()
export class ItineraryBookingsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly itinerariesService: ItinerariesService,
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
  ) {}

  /**
   * Links one of your own confirmed or completed bookings to a day of your
   * own itinerary. Checks, each answering before the next: the itinerary
   * (404, then 403), the day (404), the booking (404 when it is missing or
   * someone else's), its status (409), not linked to this itinerary yet
   * (409), room on the day (409). The add is one update conditional on the
   * version that was read, which also bumps it, as for budget entries: two
   * requests at the same moment can never link the same booking twice or pass
   * the day limit, and a day delete or move that read the itinerary before
   * cannot drop the link. A request that loses the race reads the itinerary
   * again and checks again; the booking is read only once.
   */
  async link(
    itineraryId: string,
    dto: LinkBookingDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    let copy: BookingCopy | undefined;
    for (let attempt = 1; ; attempt += 1) {
      const itinerary = await this.itinerariesService.findOwnedOrThrow(
        itineraryId,
        userId,
      );
      const day = this.itinerariesService.findDayOrThrow(itinerary, dto.dayId);
      copy ??= await this.readLinkable(dto, userId);
      if (isLinked(itinerary, copy)) {
        throw new ConflictException(BOOKING_ALREADY_LINKED_MESSAGE);
      }
      if (day.linkedBookings.length >= LINKED_BOOKINGS_PER_DAY_MAX) {
        throw new ConflictException(LINKED_BOOKINGS_PER_DAY_MESSAGE);
      }
      // The version pins the order of the days, so the day is still at the
      // position it had when it was read.
      const position = itinerary.days.indexOf(day);
      const updated = await this.itineraries.findOneAndUpdate(
        { _id: itinerary._id, __v: itinerary.__v },
        {
          $push: { [`days.${position}.linkedBookings`]: copy },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after', runValidators: true },
      );
      if (updated) {
        return toItineraryDetailResponse(updated);
      }
      if (attempt === LINK_ATTEMPTS_MAX) {
        throw new ConflictException(ITINERARY_CHANGED_MESSAGE);
      }
    }
  }

  /**
   * The copy a link keeps, read through the module that owns the booking:
   * its `findOwnedEntityOrThrow` answers 404 "Booking not found" for a
   * missing booking and for someone else's alike (ACC-11). Only a confirmed
   * or completed booking, which always has its reference, may be linked.
   */
  private async readLinkable(
    dto: LinkBookingDto,
    userId: string,
  ): Promise<BookingCopy> {
    const booking =
      dto.bookingType === LinkedBookingType.Flight
        ? await this.flightBookings.findOwnedEntityOrThrow(
            dto.bookingId,
            userId,
          )
        : await this.hotelBookings.findOwnedEntityOrThrow(
            dto.bookingId,
            userId,
          );
    if (!LINKABLE_STATUSES.has(booking.status) || !booking.reference) {
      throw new ConflictException(BOOKING_NOT_LINKABLE_MESSAGE);
    }
    return {
      bookingType: dto.bookingType,
      bookingId: booking._id,
      reference: booking.reference,
      amount: booking.total,
      currency: booking.currency,
    };
  }
}

/** Whether this booking is already linked to any day of the itinerary. */
function isLinked(itinerary: ItineraryDocument, copy: BookingCopy): boolean {
  return itinerary.days.some((day) =>
    day.linkedBookings.some(
      (link) =>
        link.bookingType === copy.bookingType &&
        link.bookingId.equals(copy.bookingId),
    ),
  );
}
