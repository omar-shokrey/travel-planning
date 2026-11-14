import { Model } from 'mongoose';
import { AirportService } from './airport.service';
import { AirportDocument } from './models/airport.schema';
import { CityDocument } from './models/city.schema';
import { CountryDocument } from './models/country.schema';

describe('AirportService', () => {
  const airportFind = jest.fn();
  const airportCountDocuments = jest.fn();
  const cityFind = jest.fn();
  const countryFind = jest.fn();

  const airportModel = {
    find: airportFind,
    countDocuments: airportCountDocuments,
  } as unknown as Model<AirportDocument>;

  const cityModel = {
    find: cityFind,
  } as unknown as Model<CityDocument>;

  const countryModel = {
    find: countryFind,
  } as unknown as Model<CountryDocument>;

  let service: AirportService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AirportService(airportModel, cityModel, countryModel);
  });

  it('returns mapped airports with default pagination', async () => {
    const execAirportFind = jest.fn().mockResolvedValue([
      {
        _id: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: 'LXR',
        name: 'Luxor International Airport',
        cityId: 'luxor',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ]);

    airportFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: execAirportFind,
    });

    airportCountDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(12),
    });

    cityFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'cairo',
          name: 'Cairo',
          countryCode: 'EG',
        },
        {
          _id: 'luxor',
          name: 'Luxor',
          countryCode: 'EG',
        },
      ]),
    });

    countryFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'EG',
          name: 'Egypt',
          currency: 'EGP',
        },
      ]),
    });

    const result = await service.findAll({
      page: 1,
      limit: 10,
      skip: 0,
    });

    expect(result).toEqual({
      items: [
        {
          code: 'CAI',
          name: 'Cairo International Airport',
          city: 'Cairo',
          country: 'Egypt',
          timeZone: 'Africa/Cairo',
        },
        {
          code: 'LXR',
          name: 'Luxor International Airport',
          city: 'Luxor',
          country: 'Egypt',
          timeZone: 'Africa/Cairo',
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      },
    });

    expect(cityFind).toHaveBeenCalledWith({
      _id: { $in: ['cairo', 'luxor'] },
    });

    expect(countryFind).toHaveBeenCalledWith({
      _id: { $in: ['EG'] },
    });
  });

  it('uses the requested page and limit', async () => {
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockReturnThis();

    airportFind.mockReturnValue({
      sort,
      skip,
      limit,
      lean,
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'CAI',
          name: 'Cairo International Airport',
          cityId: 'cairo',
          countryCode: 'EG',
          timeZone: 'Africa/Cairo',
        },
      ]),
    });

    airportCountDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(25),
    });

    cityFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'cairo',
          name: 'Cairo',
          countryCode: 'EG',
        },
      ]),
    });

    countryFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'EG',
          name: 'Egypt',
          currency: 'EGP',
        },
      ]),
    });

    const result = await service.findAll({
      page: 3,
      limit: 5,
      skip: 10,
    });

    expect(sort).toHaveBeenCalledWith({ _id: 1 });
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(5);

    expect(result.meta).toEqual({
      page: 3,
      limit: 5,
      total: 25,
      totalPages: 5,
    });
  });

  it('returns an empty page when there are no airports', async () => {
    airportFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    airportCountDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    cityFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    countryFind.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    const result = await service.findAll({
      page: 1,
      limit: 10,
      skip: 0,
    });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    });
  });
});
