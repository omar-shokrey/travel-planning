import type { AirportResponseDto } from '../dto/airport-response.dto';
import type { Airport } from '../models/airport.schema';

/** The airport fields the mapper reads. A document and a lean airport both fit. */
export type AirportSource = Pick<
  Airport,
  '_id' | 'name' | 'cityId' | 'countryCode' | 'timeZone'
>;

/**
 * Turns a stored airport into what the API returns. The city and country
 * names come from the seeded lists; if one is missing the id is shown
 * instead, so a list never fails because of one incomplete record.
 */
export function toAirportResponse(
  airport: AirportSource,
  cityNames: ReadonlyMap<string, string>,
  countryNames: ReadonlyMap<string, string>,
): AirportResponseDto {
  return {
    id: airport._id,
    name: airport.name,
    cityId: airport.cityId,
    cityName: cityNames.get(airport.cityId) ?? airport.cityId,
    countryCode: airport.countryCode,
    countryName: countryNames.get(airport.countryCode) ?? airport.countryCode,
    timeZone: airport.timeZone,
  };
}
