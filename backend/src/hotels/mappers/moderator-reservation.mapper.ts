import type { ModeratorReservationResponseDto } from '../dto/moderator-reservation-response.dto';
import type { HotelReservationRecord } from '../hotel-booking-lookup.service';

/**
 * HTL-22: a reservation of the moderator's hotel, with only the guest's name.
 * The account id, the email and every price and payment field stay inside.
 */
export function toModeratorReservationResponse(
  reservation: HotelReservationRecord,
  guestName: string | undefined,
): ModeratorReservationResponseDto {
  return {
    id: reservation._id.toString(),
    reference: reservation.reference ?? null,
    guest: { name: guestName ?? null },
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    nights: reservation.nights,
    rooms: reservation.rooms.map((room) => ({
      roomLabel: room.roomLabel,
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
  };
}
