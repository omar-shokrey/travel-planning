import type { Types } from 'mongoose';
import type { FlightBookingResponseDto } from '../dto/flight-booking-response.dto';
import type { FlightBooking } from '../models/flight-booking.schema';

export type FlightBookingSource = FlightBooking & { _id: Types.ObjectId };

/**
 * A flight booking as its owner sees it (FLT-22, FLT-19). A round trip
 * (FLT-12) has two segments, outbound then return, in `segments`. The owner id, the
 * airline id of each segment, the copied policy and the Mongo internals stay
 * inside; the reference is left out until the payment gives one (FLT-23).
 * The passengers' details are returned to the owner only: only owner routes
 * call this mapper.
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
    // A booking saved before FLT-19 has no baggage and no passengers.
    baggageTotal: booking.baggageTotal ?? 0,
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
    passengers: (booking.passengers ?? []).map((passenger) => {
      // FLT-12(a): segment 0 is the outbound flight, segment 1 the return.
      const bagsOn = (index: number) => {
        const bags = (passenger.baggage ?? []).find(
          ({ segment }) => segment === index,
        );
        return bags ? { bags: bags.bags, weightKg: bags.weightKg } : null;
      };
      return {
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        type: passenger.type,
        passportNumber: passenger.passportNumber,
        extraBags: bagsOn(0),
        returnExtraBags: bagsOn(1),
      };
    }),
    createdAt: booking.createdAt.toISOString(),
  };
}
