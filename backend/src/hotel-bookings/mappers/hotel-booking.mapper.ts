import type { Types } from 'mongoose';
import { sortTiersByDaysBefore } from '../../common/cancellation-tiers';
import type { HotelBookingResponseDto } from '../dto/hotel-booking-response.dto';
import type { HotelBooking } from '../models/hotel-booking.schema';

export type HotelBookingSource = HotelBooking & { _id: Types.ObjectId };

/**
 * A reservation as its owner sees it (HTL-16, HTL-18, HTL-20). The hotel's
 * name is read by the caller, because the reservation stores only its id.
 */
export function toHotelBookingResponse(
  booking: HotelBookingSource,
  hotelName: string | null,
): HotelBookingResponseDto {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    hotelId: booking.hotelId.toString(),
    hotelName,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    status: booking.status,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    currency: booking.currency,
    total: booking.total,
    rooms: booking.rooms.map((room) => ({
      roomId: room.roomId.toString(),
      roomLabel: room.roomLabel,
      pricePerNight: room.pricePerNight,
      subtotal: room.pricePerNight * booking.nights,
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    checkInTime: booking.checkInTime ?? null,
    checkOutTime: booking.checkOutTime ?? null,
    cancellationTiers: sortTiersByDaysBefore(booking.cancellationTiers).map(
      ({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }),
    ),
    policyAcceptedAt: booking.policyAcceptedAt.toISOString(),
    createdAt: booking.createdAt.toISOString(),
  };
}
