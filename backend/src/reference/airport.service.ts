import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DEFAULT_PAGE_SIZE,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { Airport, type AirportDocument } from './models/airport.schema';

@Injectable()
export class AirportService {
  constructor(
    @InjectModel(Airport.name)
    private readonly airportModel: Model<AirportDocument>,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const [items, total] = await Promise.all([
      this.airportModel
        .find()
        .sort({ _id: 1 })
        .skip(query.skip)
        .limit(limit)
        .lean()
        .exec(),
      this.airportModel.countDocuments().exec(),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
