import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirportService } from './airport.service';
import { Airport, type AirportDocument } from './models/airport.schema';
import { City, type CityDocument } from './models/city.schema';
import { Country, type CountryDocument } from './models/country.schema';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

describe('AirportService', () => {
  let service: AirportService;
  let airportModel: jest.Mocked<Model<AirportDocument>>;
  let cityModel: jest.Mocked<Model<CityDocument>>;
  let countryModel: jest.Mocked<Model<CountryDocument>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirportService,
        {
          provide: getModelToken(Airport.name),
          useValue: {
            find: jest.fn(),
            countDocuments: jest.fn(),
          },
        },
        {
          provide: getModelToken(City.name),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getModelToken(Country.name),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AirportService>(AirportService);
    airportModel = module.get(getModelToken(Airport.name));
    cityModel = module.get(getModelToken(City.name));
    countryModel = module.get(getModelToken(Country.name));
  });

  it('returns a paginated airport list with city and country names', async () => {
    const airports = [
      {
        _id: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ];

    const cities = [
      {
        _id: 'cairo',
        name: 'Cairo',
        countryCode: 'EG',
      },
    ];

    const countries = [
      {
        _id: 'EG',
        name: 'Egypt',
        currency: 'EGP',
      },
    ];

    const airportFind = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(airports),
    };

    const cityFind = {
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(cities),
    };

    const countryFind = {
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(countries),
    };

    airportModel.find.mockReturnValue(
      airportFind as unknown as ReturnType<typeof airportModel.find>,
    );

    airportModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    } as unknown as ReturnType<typeof airportModel.countDocuments>);

    cityModel.find.mockReturnValue(
      cityFind as unknown as ReturnType<typeof cityModel.find>,
    );

    countryModel.find.mockReturnValue(
      countryFind as unknown as ReturnType<typeof countryModel.find>,
    );

    const query = new PaginationQueryDto();

    const result = await service.findAll(query);

    expect(result).toEqual({
      items: [
        {
          code: 'CAI',
          name: 'Cairo International Airport',
          city: 'Cairo',
          country: 'Egypt',
          timeZone: 'Africa/Cairo',
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('uses pagination and deterministic airport sorting', async () => {
    const airportFind = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    airportModel.find.mockReturnValue(
      airportFind as unknown as ReturnType<typeof airportModel.find>,
    );

    airportModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    } as unknown as ReturnType<typeof airportModel.countDocuments>);

    cityModel.find.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof cityModel.find>);

    countryModel.find.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof countryModel.find>);

    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 5;

    await service.findAll(query);

    expect(airportFind.sort).toHaveBeenCalledWith({ _id: 1 });
    expect(airportFind.skip).toHaveBeenCalledWith(5);
    expect(airportFind.limit).toHaveBeenCalledWith(5);
  });
});
