import type { Types } from 'mongoose';
import type { FlightBookingResponseDto } from '../dto/flight-booking-response.dto';
import type { FlightBooking } from '../models/flight-booking.schema';

export type FlightBookingSource = FlightBooking & { _id: Types.ObjectId };

/**
 * A flight booking as its owner sees it (FLT-22). The owner id, the airline
 * id of each segment and the Mongo internals stay inside; the reference is
 * left out until the payment gives one (FLT-23).
 */
export function toFlightBookingResponse(
  booking: FlightBookingSource,
): FlightBookingResponseDto {
  return {
    id: booking._id.toString(),
    ...(booking.reference ? { reference: booking.reference } : {}),
    status: booking.status,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    currency: booking.currency,
    fareTotal: booking.fareTotal,
    total: booking.total,
    segments: booking.segments.map((segment) => ({
      flightId: segment.flightId.toString(),
      cabin: segment.cabin,
      fare: segment.fare,
      seatsReserved: segment.seatsReserved,
    })),
    passengerCounts: {
      adults: booking.passengerCounts.adults,
      children: booking.passengerCounts.children,
      infants: booking.passengerCounts.infants,
    },
    createdAt: booking.createdAt.toISOString(),
  };
}
