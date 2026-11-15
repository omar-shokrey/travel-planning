import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AirportsService } from './airports.service';
import { Airport } from './models/airport.schema';
import { City } from './models/city.schema';
import { Country } from './models/country.schema';

const cairo = {
  _id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryCode: 'EG',
  timeZone: 'Africa/Cairo',
};
const dubai = {
  _id: 'DXB',
  name: 'Dubai International Airport',
  cityId: 'dubai',
  countryCode: 'AE',
  timeZone: 'Asia/Dubai',
};

/** Replaces find().select().lean() on a reference collection. */
const namesModel = (rows: { _id: string; name: string }[]) => ({
  find: jest.fn((filter: { _id: { $in: string[] } }) => ({
    select: () => ({
      lean: () =>
        Promise.resolve(rows.filter((row) => filter._id.$in.includes(row._id))),
    }),
  })),
});

const page = (pageNumber: number, limit: number) =>
  Object.assign(new PaginationQueryDto(), { page: pageNumber, limit });

describe('AirportsService', () => {
  let service: AirportsService;
  let chain: {
    sort: jest.Mock;
    skip: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
  };
  let airportModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
  };

  const withAirports = (rows: (typeof cairo)[], total = rows.length) => {
    chain.lean.mockResolvedValue(rows);
    airportModel.countDocuments.mockResolvedValue(total);
  };

  beforeEach(async () => {
    chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn(),
    };
    airportModel = {
      find: jest.fn().mockReturnValue(chain),
      countDocuments: jest.fn(),
      findById: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AirportsService,
        { provide: getModelToken(Airport.name), useValue: airportModel },
        {
          provide: getModelToken(City.name),
          useValue: namesModel([
            { _id: 'cairo', name: 'Cairo' },
            { _id: 'dubai', name: 'Dubai' },
          ]),
        },
        {
          provide: getModelToken(Country.name),
          useValue: namesModel([
            { _id: 'EG', name: 'Egypt' },
            { _id: 'AE', name: 'United Arab Emirates' },
          ]),
        },
      ],
    }).compile();
    service = moduleRef.get(AirportsService);
  });

  describe('findAll', () => {
    it('returns each airport with its city and country names', async () => {
      withAirports([cairo, dubai]);

      const response = await service.findAll(page(1, 10));

      expect(response.items).toEqual([
        {
          code: 'CAI',
          name: 'Cairo International Airport',
          cityId: 'cairo',
          cityName: 'Cairo',
          countryCode: 'EG',
          countryName: 'Egypt',
          timeZone: 'Africa/Cairo',
        },
        {
          code: 'DXB',
          name: 'Dubai International Airport',
          cityId: 'dubai',
          cityName: 'Dubai',
          countryCode: 'AE',
          countryName: 'United Arab Emirates',
          timeZone: 'Asia/Dubai',
        },
      ]);
    });

    it('sorts by IATA code and reads the requested page', async () => {
      withAirports([dubai], 11);

      const response = await service.findAll(page(2, 10));

      expect(chain.sort).toHaveBeenCalledWith({ _id: 1 });
      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(response.meta).toEqual({
        page: 2,
        limit: 10,
        total: 11,
        totalPages: 2,
      });
    });

    it('returns an empty list when no airport is loaded', async () => {
      withAirports([]);

      await expect(service.findAll(page(1, 10))).resolves.toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('findEntityOrThrow', () => {
    it('returns an airport from the list', async () => {
      airportModel.findById.mockResolvedValue(cairo);

      await expect(service.findEntityOrThrow('CAI')).resolves.toBe(cairo);
      expect(airportModel.findById).toHaveBeenCalledWith('CAI');
    });

    it('answers 400 for a code that is not in the list', async () => {
      airportModel.findById.mockResolvedValue(null);

      await expect(service.findEntityOrThrow('XXX')).rejects.toThrow(
        new BadRequestException('Unknown airport code: XXX'),
      );
    });
  });
});
