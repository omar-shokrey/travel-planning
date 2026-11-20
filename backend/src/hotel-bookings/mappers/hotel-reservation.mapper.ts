import { sortTiersByDaysBefore } from '../../common/cancellation-tiers';
import type { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import type {
  HotelReservationDetailsDto,
  HotelReservationListItemDto,
  ReservationGuestsDto,
} from '../dto/hotel-reservation-response.dto';
import type { ReservationGroup } from '../enums/reservation-group.enum';
import { groupOf } from '../hotel-reservation-groups';
import type { HotelBookingSource } from './hotel-booking.mapper';

/** How many adults and children the reservation is for, over all its rooms. */
function guestsOf(booking: HotelBookingSource): ReservationGuestsDto {
  return {
    adults: booking.rooms.reduce((sum, room) => sum + room.adults, 0),
    children: booking.rooms.reduce(
      (sum, room) => sum + room.childAges.length,
      0,
    ),
  };
}

const hotelOf = (booking: HotelBookingSource, name: string | undefined) => ({
  id: booking.hotelId.toString(),
  name: name ?? null,
});

/**
 * HTL-20: one reservation in the user's list. `group` is the group the list
 * was filtered on, or the reservation's own group (`groupOf`). The owner id,
 * the hold, the policy acceptance and the Mongo internals stay inside.
 */
export function toHotelReservationListItem(
  booking: HotelBookingSource,
  hotelName: string | undefined,
  group: ReservationGroup,
): HotelReservationListItemDto {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    hotel: hotelOf(booking, hotelName),
    rooms: booking.rooms.map((room) => ({
      roomLabel: room.roomLabel,
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    guests: guestsOf(booking),
    total: booking.total,
    currency: booking.currency,
    status: booking.status,
    group,
  };
}

/**
 * HTL-20: the full details of the user's own reservation, with its refund
 * (PAY-03) when there is one. `holdExpiresAt`, `policyAcceptedAt`, the owner
 * id and the Mongo internals are never returned.
 */
export function toHotelReservationDetails(
  booking: HotelBookingSource,
  hotelName: string | undefined,
  refund: RefundSummaryDto | null,
  today: string,
): HotelReservationDetailsDto {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    hotel: hotelOf(booking, hotelName),
    status: booking.status,
    group: groupOf(booking, today),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    checkInTime: booking.checkInTime ?? null,
    checkOutTime: booking.checkOutTime ?? null,
    rooms: booking.rooms.map((room) => ({
      roomId: room.roomId.toString(),
      roomLabel: room.roomLabel,
      pricePerNight: room.pricePerNight,
      subtotal: room.pricePerNight * booking.nights,
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    guests: guestsOf(booking),
    total: booking.total,
    currency: booking.currency,
    cancellationTiers: sortTiersByDaysBefore(booking.cancellationTiers).map(
      ({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }),
    ),
    refund: refund && {
      id: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      refundPercent: refund.refundPercent,
    },
    createdAt: booking.createdAt.toISOString(),
  };
}
