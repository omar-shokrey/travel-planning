import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { imageUrl } from '../../uploads/uploads.constants';
import type {
  FlightDetailsCabinResponseDto,
  FlightDetailsResponseDto,
} from '../dto/flight-details-response.dto';
import type { Airline } from '../models/airline.schema';
import { toAirlinePolicyFields } from './airline.mapper';
import {
  type CabinSource,
  type FlightSource,
  type FlightTimeZones,
  toFlightResponse,
} from './flight.mapper';

/** The airline fields the details page shows. */
export type DetailsAirlineSource = Pick<
  Airline,
  'name' | 'code' | 'logo' | 'policy'
> & { _id: Types.ObjectId };

const MINUTE_MS = 60_000;

/** A cabin on the details page: no seat counters, only the seats remaining (never below 0). */
export function toFlightDetailsCabin(
  cabin: CabinSource,
): FlightDetailsCabinResponseDto {
  return {
    id: cabin._id.toString(),
    cabin: cabin.cabin,
    price: cabin.price,
    currency: PLATFORM_CURRENCY,
    seatsRemaining: Math.max(
      0,
      cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
    ),
    freeBags: cabin.freeBags,
    maxBagKg: cabin.maxBagKg,
  };
}

/**
 * Maps a flight and its airline to the details page (FLT-17). The flight goes
 * through `toFlightResponse`, so the times, the local times (GEN-06) and the
 * status at `now` (FLT-30) are those of every flight response. Pure: no clock
 * and no database.
 */
export function toFlightDetails(
  flight: FlightSource,
  airline: DetailsAirlineSource,
  now: Date,
  zones: FlightTimeZones,
): FlightDetailsResponseDto {
  const {
    airlineId: _airlineId,
    cabins: _cabins,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...response
  } = toFlightResponse(flight, now, zones);
  return {
    ...response,
    airline: {
      id: airline._id.toString(),
      name: airline.name,
      code: airline.code,
      logoUrl: imageUrl(airline.logo),
    },
    durationMinutes: Math.round(
      (flight.arrivalAt.getTime() - flight.departureAt.getTime()) / MINUTE_MS,
    ),
    cabins: (flight.cabins ?? []).map(toFlightDetailsCabin),
    ...toAirlinePolicyFields(airline.policy),
  };
}
