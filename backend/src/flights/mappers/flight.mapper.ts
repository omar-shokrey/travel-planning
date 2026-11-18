import type { Types } from 'mongoose';
import type { FlightResponseDto } from '../dto/flight-response.dto';
import type { Flight } from '../models/flight.schema';

/** The fields the mapper reads. A document and a lean flight both fit. */
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
> & { _id: Types.ObjectId };

/** Maps a flight to its public API fields: ids as strings, moments as UTC ISO strings. */
export function toFlightResponse(flight: FlightSource): FlightResponseDto {
  return {
    id: flight._id.toString(),
    airlineId: flight.airlineId.toString(),
    flightNumber: flight.flightNumber,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureAt: flight.departureAt.toISOString(),
    arrivalAt: flight.arrivalAt.toISOString(),
    departureDateLocal: flight.departureDateLocal,
    status: flight.status,
    createdAt: flight.createdAt.toISOString(),
    updatedAt: flight.updatedAt.toISOString(),
  };
}
