import { AirportService } from './airport.service';

describe('AirportService', () => {
  const find = jest.fn();
  const countDocuments = jest.fn();

  const airportModel = {
    find,
    countDocuments,
  } as any;

  let service: AirportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AirportService(airportModel);
  });

  it('returns airports with default pagination', async () => {
    const execFind = jest.fn().mockResolvedValue([
      { _id: 'CAI', name: 'Cairo International Airport' },
      { _id: 'LXR', name: 'Luxor International Airport' },
    ]);

    find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: execFind,
    });

    countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(12),
    });

    const result = await service.findAll({
      page: 1,
      limit: 10,
      skip: 0,
    });

    expect(result).toEqual({
      items: [
        { _id: 'CAI', name: 'Cairo International Airport' },
        { _id: 'LXR', name: 'Luxor International Airport' },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      },
    });

    expect(find).toHaveBeenCalled();
    expect(countDocuments).toHaveBeenCalled();
  });

  it('uses the requested page and limit', async () => {
    const execFind = jest.fn().mockResolvedValue([]);

    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockReturnThis();

    find.mockReturnValue({
      sort,
      skip,
      limit,
      lean,
      exec: execFind,
    });

    countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(25),
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
});
