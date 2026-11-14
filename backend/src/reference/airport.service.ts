import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DEFAULT_PAGE_SIZE,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { Airport, type AirportDocument } from './models/airport.schema';
import { City, type CityDocument } from './models/city.schema';
import { Country, type CountryDocument } from './models/country.schema';
import { toAirportResponse } from './mappers/airport.mapper';
import { paginate } from '../common/dto/paginated-response.dto';

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
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const [airports, total] = await Promise.all([
      this.airportModel
        .find()
        .sort({ _id: 1 })
        .skip(query.skip)
        .limit(limit)
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

      if (!city) {
        throw new NotFoundException(
          `City ${airport.cityId} referenced by airport ${airport._id} was not found`,
        );
      }

      if (!country) {
        throw new NotFoundException(
          `Country ${airport.countryCode} referenced by airport ${airport._id} was not found`,
        );
      }

      return toAirportResponse(airport, city, country);
    });

    return paginate(items, total, query);
  }
}
