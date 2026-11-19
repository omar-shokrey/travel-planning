import type { Types } from 'mongoose';
import { imageUrl } from '../../uploads/uploads.constants';
import type {
  FlightSearchCabinResponseDto,
  FlightSearchResultResponseDto,
} from '../dto/flight-search-result-response.dto';
import type { Airline } from '../models/airline.schema';
import {
  type CabinSource,
  type FlightSource,
  type FlightTimeZones,
  toCabinResponse,
  toFlightResponse,
} from './flight.mapper';

/** The airline fields a search result shows. */
export type SearchAirlineSource = Pick<Airline, 'name' | 'code' | 'logo'> & {
  _id: Types.ObjectId;
};

/**
 * A flight as the search query gives it: the stored flight without its
 * cabins, the cabins that fit the party, and its airline.
 */
export type FlightSearchSource = Omit<FlightSource, 'cabins'> & {
  fittingCabins: CabinSource[];
  airline: SearchAirlineSource;
};

/** A cabin of a search result: no seat counters and no seat total, only what is needed to choose. */
export function toFlightSearchCabin(
  cabin: CabinSource,
): FlightSearchCabinResponseDto {
  const {
    id,
    cabin: category,
    price,
    currency,
    availableSeats,
    freeBags,
    maxBagKg,
  } = toCabinResponse(cabin);
  return {
    id,
    cabin: category,
    price,
    currency,
    availableSeats,
    freeBags,
    maxBagKg,
  };
}

/**
 * Maps one search result (FLT-11). The flight goes through `toFlightResponse`,
 * so it has every field and the local times (GEN-06) of any flight response;
 * its cabins are only the ones that fit, and the airline is added. Pure: no
 * clock and no database.
 */
export function toFlightSearchResult(
  flight: FlightSearchSource,
  now: Date,
  zones: FlightTimeZones,
): FlightSearchResultResponseDto {
  const { fittingCabins, airline, ...stored } = flight;
  const { cabins: _none, ...response } = toFlightResponse(
    { ...stored, cabins: [] },
    now,
    zones,
  );
  return {
    ...response,
    airline: {
      id: airline._id.toString(),
      name: airline.name,
      code: airline.code,
      logoUrl: imageUrl(airline.logo),
    },
    cabins: fittingCabins.map(toFlightSearchCabin),
  };
}
