import { Airport } from '../models/airport.schema';
import { City } from '../models/city.schema';
import { Country } from '../models/country.schema';
import { AirportResponseDto } from '../dto/airport-response.dto';

export const toAirportResponse = (
  airport: Airport,
  city: City,
  country: Country,
): AirportResponseDto => ({
  code: airport._id,
  name: airport.name,
  city: city.name,
  country: country.name,
  timeZone: airport.timeZone,
});
