import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { paginate } from '../common/dto/paginated-response.dto';
import { Airport, type AirportDocument } from './models/airport.schema';
import { City, type CityDocument } from './models/city.schema';
import { Country, type CountryDocument } from './models/country.schema';
import { toAirportResponse } from './mappers/airport.mapper';

@Injectable()
export class AirportService {
  constructor(
    @InjectModel(Airport.name)
    private readonly airportModel: Model<AirportDocument>,
    @InjectModel(City.name)
    private readonly cityModel: Model<CityDocument>,
    @InjectModel(Country.name)
    private readonly countryModel: Model<CountryDocument>,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const [airports, total] = await Promise.all([
      this.airportModel
        .find()
        .sort({ _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.airportModel.countDocuments().exec(),
    ]);

    const cityIds = [...new Set(airports.map((airport) => airport.cityId))];
    const countryCodes = [
      ...new Set(airports.map((airport) => airport.countryCode)),
    ];

    const [cities, countries] = await Promise.all([
      this.cityModel
        .find({ _id: { $in: cityIds } })
        .lean()
        .exec(),
      this.countryModel
        .find({ _id: { $in: countryCodes } })
        .lean()
        .exec(),
    ]);

    const cityMap = new Map(cities.map((city) => [city._id, city]));
    const countryMap = new Map(
      countries.map((country) => [country._id, country]),
    );

    const items = airports.map((airport) => {
      const city = cityMap.get(airport.cityId);
      const country = countryMap.get(airport.countryCode);

      if (!city || !country) {
        throw new Error(`Invalid reference data for airport ${airport._id}`);
      }

      return toAirportResponse(airport, city, country);
    });

    return paginate(items, total, query);
  }
}
