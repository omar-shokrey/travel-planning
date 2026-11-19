import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { CabinResponseDto } from '../dto/cabin-response.dto';
import type { FlightResponseDto } from '../dto/flight-response.dto';
import { toLocalTime } from '../flight-local-time';
import { effectiveStatus } from '../flight-status';
import type { Flight, FlightCabin } from '../models/flight.schema';

/** The fields the mapper reads of a cabin. A subdocument and a lean cabin both fit. */
export type CabinSource = Pick<
  FlightCabin,
  | '_id'
  | 'cabin'
  | 'totalSeats'
  | 'bookedSeats'
  | 'heldSeats'
  | 'price'
  | 'freeBags'
  | 'maxBagKg'
>;

/**
 * The fields the mapper reads. A document and a lean flight both fit; a lean
 * flight stored before FLT-04 has no `cabins`.
 */
export type FlightSource = Pick<
  Flight,
  | 'airlineId'
  | 'flightNumber'
  | 'departureAirport'
  | 'arrivalAirport'
  | 'departureAt'
  | 'arrivalAt'
  | 'departureDateLocal'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId; cabins?: CabinSource[] };

/**
 * Maps a cabin to its public fields (FLT-04). The seat counters stay inside:
 * only `availableSeats` (`totalSeats - bookedSeats - heldSeats`) is returned.
 * Prices are in the platform currency (PAY-04), which is not stored per cabin.
 */
export function toCabinResponse(cabin: CabinSource): CabinResponseDto {
  return {
    id: cabin._id.toString(),
    cabin: cabin.cabin,
    totalSeats: cabin.totalSeats,
    availableSeats: cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
    price: cabin.price,
    currency: PLATFORM_CURRENCY,
    freeBags: cabin.freeBags,
    maxBagKg: cabin.maxBagKg,
  };
}

/** The IANA time zones of a flight's two airports (GEN-06). */
export interface FlightTimeZones {
  departure: string;
  arrival: string;
}

/**
 * Maps a flight to its public API fields: ids as strings, moments as UTC ISO
 * strings, each time also at its own airport (GEN-06: local time, zone and
 * offset, from `zones`), and the status at `now` (FLT-30: a scheduled flight
 * whose departure has passed is departed). `now` and `zones` are required, so
 * the mapper reads no clock and no database, and no caller can forget them.
 */
export function toFlightResponse(
  flight: FlightSource,
  now: Date,
  zones: FlightTimeZones,
): FlightResponseDto {
  const departure = toLocalTime(flight.departureAt, zones.departure);
  const arrival = toLocalTime(flight.arrivalAt, zones.arrival);
  return {
    id: flight._id.toString(),
    airlineId: flight.airlineId.toString(),
    flightNumber: flight.flightNumber,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureAt: flight.departureAt.toISOString(),
    arrivalAt: flight.arrivalAt.toISOString(),
    departureLocal: departure.local,
    departureTimeZone: departure.timeZone,
    departureUtcOffset: departure.utcOffset,
    arrivalLocal: arrival.local,
    arrivalTimeZone: arrival.timeZone,
    arrivalUtcOffset: arrival.utcOffset,
    departureDateLocal: flight.departureDateLocal,
    status: effectiveStatus(flight, now),
    cabins: (flight.cabins ?? []).map(toCabinResponse),
    createdAt: flight.createdAt.toISOString(),
    updatedAt: flight.updatedAt.toISOString(),
  };
}
