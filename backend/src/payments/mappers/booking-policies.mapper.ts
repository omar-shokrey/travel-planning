import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { FlightBookingSource } from '../../flight-bookings/mappers/flight-booking.mapper';
import type { HotelBookingSource } from '../../hotel-bookings/mappers/hotel-booking.mapper';
import type {
  BookingPoliciesResponseDto,
  PolicyCancellationTierDto,
} from '../dto/booking-policies-response.dto';
import { BookingType } from '../enums/booking-type.enum';
import { PENDING_PAYMENT } from '../payments.constants';

/** The fields both kinds of booking share. */
type CommonSource = Pick<
  FlightBookingSource,
  '_id' | 'holdExpiresAt' | 'policyAcceptedAt'
> & { status: string };

/** Tiers in the stored order (highest `daysBefore` first), without Mongo internals. */
const tiersOf = (
  tiers: readonly PolicyCancellationTierDto[] | undefined,
): PolicyCancellationTierDto[] =>
  (tiers ?? []).map(({ daysBefore, refundPercent }) => ({
    daysBefore,
    refundPercent,
  }));

const common = (type: BookingType, booking: CommonSource) => ({
  type,
  bookingId: booking._id.toString(),
  status: booking.status,
  holdExpiresAt:
    booking.status === PENDING_PAYMENT && booking.holdExpiresAt
      ? booking.holdExpiresAt.toISOString()
      : null,
  policyAcceptedAt: booking.policyAcceptedAt?.toISOString() ?? null,
});

/**
 * PAY-02: the airline's policies of a flight booking, as copied into each
 * segment when the seats were held. A segment saved before the copy existed
 * shows empty tiers, no extra bags and `null` for the free allowance; the
 * live airline is never read, so what is shown is what a refund will use.
 */
export function toFlightBookingPolicies(
  booking: FlightBookingSource,
): BookingPoliciesResponseDto {
  return {
    ...common(BookingType.Flight, booking),
    flight: {
      segments: booking.segments.map((segment) => ({
        flightId: segment.flightId.toString(),
        cabin: segment.cabin,
        cancellationTiers: tiersOf(segment.cancellationTiers),
        baggage: {
          freeBags: segment.freeBags ?? null,
          maxBagKg: segment.maxBagKg ?? null,
          extraBagPrice: segment.extraBagPrice ?? null,
          maxExtraBags: segment.maxExtraBags ?? 0,
          currency: PLATFORM_CURRENCY,
        },
      })),
    },
  };
}

/** PAY-02: the hotel's policies of a reservation, as copied when it was made (HTL-16). */
export function toHotelBookingPolicies(
  booking: HotelBookingSource,
): BookingPoliciesResponseDto {
  return {
    ...common(BookingType.Hotel, booking),
    hotel: {
      checkInTime: booking.checkInTime ?? null,
      checkOutTime: booking.checkOutTime ?? null,
      cancellationTiers: tiersOf(booking.cancellationTiers),
    },
  };
}
