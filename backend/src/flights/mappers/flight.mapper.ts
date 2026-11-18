import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { CabinResponseDto } from '../dto/cabin-response.dto';
import type { FlightResponseDto } from '../dto/flight-response.dto';
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

/**
 * Maps a flight to its public API fields: ids as strings, moments as UTC ISO
 * strings, and the status at `now` (FLT-30: a scheduled flight whose departure
 * has passed is departed). `now` is required, so the mapper reads no clock and
 * no caller can forget it.
 */
export function toFlightResponse(
  flight: FlightSource,
  now: Date,
): FlightResponseDto {
  return {
    id: flight._id.toString(),
    airlineId: flight.airlineId.toString(),
    flightNumber: flight.flightNumber,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureAt: flight.departureAt.toISOString(),
    arrivalAt: flight.arrivalAt.toISOString(),
    departureDateLocal: flight.departureDateLocal,
    status: effectiveStatus(flight, now),
    cabins: (flight.cabins ?? []).map(toCabinResponse),
    createdAt: flight.createdAt.toISOString(),
    updatedAt: flight.updatedAt.toISOString(),
  };
}
