import type { Types } from 'mongoose';
import type { FlightBooking } from '../../flight-bookings/models/flight-booking.schema';
import type { FlightBookingOfFlightDto } from '../dto/flight-bookings-response.dto';

/** What FLT-29 reads of a booking. */
export type BookingOfFlightSource = Pick<
  FlightBooking,
  'reference' | 'status' | 'segments' | 'passengers' | 'cancelledAt'
> & { _id: Types.ObjectId };

/**
 * FLT-29: a booking as the airline of `flightId` sees it: the reference, the
 * status, the cabin and seats of its segment on that flight (a round trip has
 * one segment on each of two flights), and the passengers' names and types.
 * No passport number, date of birth, price or owner leaves for the airline.
 */
export function toFlightBookingOfFlight(
  booking: BookingOfFlightSource,
  flightId: Types.ObjectId,
): FlightBookingOfFlightDto {
  const segment =
    booking.segments.find((stored) => stored.flightId.equals(flightId)) ??
    booking.segments[0];
  return {
    bookingId: booking._id.toString(),
    // Every paid booking has a reference (FLT-23).
    reference: booking.reference ?? '',
    status: booking.status,
    cabin: segment.cabin,
    seats: segment.seatsReserved,
    passengers: (booking.passengers ?? []).map(({ fullName, type }) => ({
      fullName,
      type,
    })),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
  };
}
