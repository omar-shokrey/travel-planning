import type { HotelReservationResponseDto } from '../dto/hotel-reservation-response.dto';
import type { HotelBookingSource } from './hotel-booking.mapper';

/**
 * A reservation as the hotel moderator sees it (HTL-22): the guest, the
 * dates, the rooms with their guests, and the status. No policy acceptance,
 * hold or owner id: those are the guest's business.
 */
export function toHotelReservationResponse(
  booking: HotelBookingSource,
  guestName: string | null,
): HotelReservationResponseDto {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    guestName,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    status: booking.status,
    rooms: booking.rooms.map((room) => ({
      roomId: room.roomId.toString(),
      roomLabel: room.roomLabel,
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    total: booking.total,
    currency: booking.currency,
    createdAt: booking.createdAt.toISOString(),
  };
}
