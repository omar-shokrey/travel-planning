import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AirportResponseDto } from './dto/airport-response.dto';
import { toAirportResponse } from './mappers/airport.mapper';
import { Airport, type AirportDocument } from './models/airport.schema';
import { City } from './models/city.schema';
import { Country } from './models/country.schema';

@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
  ) {}

  /** FLT-02: the predefined airports, sorted by IATA code. */
  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<AirportResponseDto>> {
    const [airports, total] = await Promise.all([
      this.airports
        .find()
        .sort({ _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean(),
      this.airports.countDocuments(),
    ]);

    const cityIds = [...new Set(airports.map((airport) => airport.cityId))];
    const countryCodes = [
      ...new Set(airports.map((airport) => airport.countryCode)),
    ];
    const [cities, countries] = await Promise.all([
      this.cities
        .find({ _id: { $in: cityIds } })
        .select('name')
        .lean(),
      this.countries
        .find({ _id: { $in: countryCodes } })
        .select('name')
        .lean(),
    ]);
    const cityNames = new Map(cities.map((city) => [city._id, city.name]));
    const countryNames = new Map(
      countries.map((country) => [country._id, country.name]),
    );

    return paginate(
      airports.map((airport) =>
        toAirportResponse(airport, cityNames, countryNames),
      ),
      total,
      query,
    );
  }

  /**
   * FLT-02: flight creation (FLT-03) and flight search (FLT-11) accept only
   * airports from this list. Other services call this with the code the
   * client sent; an unknown code is invalid input, so the answer is 400.
   * Never expose it through a controller.
   */
  async findEntityOrThrow(code: string): Promise<AirportDocument> {
    const airport = await this.airports.findById(code);
    if (!airport) {
      throw new BadRequestException(`Unknown airport code: ${code}`);
    }
    return airport;
  }
}
