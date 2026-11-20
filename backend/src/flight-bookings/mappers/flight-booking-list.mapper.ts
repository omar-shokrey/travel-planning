import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import type { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import type { FlightBookingDetailsResponseDto } from '../dto/flight-booking-details-response.dto';
import type {
  BookedFlightResponseDto,
  FlightBookingListItemResponseDto,
} from '../dto/flight-booking-list-item-response.dto';
import { type SeatRecord, toSegmentSeats } from './booking-seats.mapper';
import {
  type FlightBookingSource,
  toFlightBookingResponse,
} from './flight-booking.mapper';

/** The flights of a page, by id, as FlightResponsesService returns them. */
export type FlightsById = ReadonlyMap<string, FlightResponseDto>;

/** The part of a flight a list shows (FLT-25): route, times and status. */
export function toBookedFlight(
  flight: FlightResponseDto,
): BookedFlightResponseDto {
  return {
    id: flight.id,
    flightNumber: flight.flightNumber,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureAt: flight.departureAt,
    departureLocal: flight.departureLocal,
    departureTimeZone: flight.departureTimeZone,
    arrivalAt: flight.arrivalAt,
    arrivalLocal: flight.arrivalLocal,
    arrivalTimeZone: flight.arrivalTimeZone,
    departureDateLocal: flight.departureDateLocal,
    status: flight.status,
  };
}

/**
 * FLT-25: one booking in a list of its owner's bookings: reference, each
 * flight with its date, cabin and seats, the passengers' names and types,
 * and the status, and the chosen seats (FLT-28; `seats` are the booking's
 * assignments). Passport numbers and dates of birth are only in the details.
 */
export function toFlightBookingListItem(
  booking: FlightBookingSource,
  flights: FlightsById,
  seats: readonly SeatRecord[],
): FlightBookingListItemResponseDto {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    status: booking.status,
    segments: booking.segments.map((segment) => {
      const flight = flights.get(segment.flightId.toString());
      return {
        cabin: segment.cabin,
        seatsReserved: segment.seatsReserved,
        flight: flight ? toBookedFlight(flight) : null,
      };
    }),
    passengers: (booking.passengers ?? []).map(({ fullName, type }) => ({
      fullName,
      type,
    })),
    total: booking.total,
    currency: booking.currency,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    seats: toSegmentSeats(booking, seats),
  };
}

/**
 * FLT-25: the full details of a booking for its owner: everything the hold
 * returned (passengers with their passport numbers, bags, fares, totals),
 * the full flight of each segment, and the acceptance and cancellation
 * fields, and the chosen seats (FLT-28; `seats` are the booking's
 * assignments). Only owner routes call it.
 */
export function toFlightBookingDetails(
  booking: FlightBookingSource,
  flights: FlightsById,
  refund: RefundSummaryDto | null,
  seats: readonly SeatRecord[],
): FlightBookingDetailsResponseDto {
  return {
    ...toFlightBookingResponse(booking),
    flights: booking.segments.map(
      (segment) => flights.get(segment.flightId.toString()) ?? null,
    ),
    policyAcceptedAt: booking.policyAcceptedAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancelledBy: booking.cancelledBy ?? null,
    refundPercent: booking.refundPercent ?? null,
    refund,
    seats: toSegmentSeats(booking, seats),
  };
}
