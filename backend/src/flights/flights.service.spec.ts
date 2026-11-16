import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { User, type UserDocument } from '../users/models/user.schema';

import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsService } from './flights.service';
import {
  Flight,
  FlightStatus,
  type FlightDocument,
} from './models/flight.schema';

describe('FlightsService', () => {
  let service: FlightsService;
  let flightModel: jest.Mocked<Model<FlightDocument>>;
  let userModel: jest.Mocked<Model<UserDocument>>;

  const airlineId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        {
          provide: getModelToken(Flight.name),
          useValue: {
            exists: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getModelToken(User.name),
          useValue: {
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FlightsService>(FlightsService);
    flightModel = module.get(getModelToken(Flight.name));
    userModel = module.get(getModelToken(User.name));
  });

  const createDto = (): CreateFlightDto => ({
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: '2027-01-10T10:00:00.000Z',
    arrivalAt: '2027-01-10T18:00:00.000Z',
    departureDateLocal: '2027-01-10',
    cabins: [
      {
        cabin: 'economy',
        totalSeats: 180,
        bookedSeats: 0,
        heldSeats: 0,
        price: 50000,
        freeBags: 1,
        maxBagKg: 23,
      },
    ],
  });

  const createUser = (overrides = {}) =>
    ({
      _id: userId,
      role: Role.AirlineModerator,
      assignment: {
        providerType: ProviderType.Airline,
        providerId: airlineId,
      },
      ...overrides,
    }) as UserDocument;

  it('creates a scheduled flight using the moderator airline assignment', async () => {
    const dto = createDto();

    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    flightModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof flightModel.exists>);

    const createdFlight = {
      _id: new Types.ObjectId(),
      airlineId,
      flightNumber: dto.flightNumber,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureAt: new Date(dto.departureAt),
      arrivalAt: new Date(dto.arrivalAt),
      departureDateLocal: dto.departureDateLocal,
      status: FlightStatus.Scheduled,
      cabins: dto.cabins,
    } as unknown as FlightDocument;

    flightModel.create.mockResolvedValue(createdFlight);

    const result = await service.create(userId.toString(), dto);

    expect(flightModel.create).toHaveBeenCalledWith({
      airlineId,
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: new Date(dto.departureAt),
      arrivalAt: new Date(dto.arrivalAt),
      departureDateLocal: '2027-01-10',
      status: FlightStatus.Scheduled,
      cabins: dto.cabins,
    });

    expect(result).toMatchObject({
      airlineId: airlineId.toString(),
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureDateLocal: '2027-01-10',
      status: FlightStatus.Scheduled,
    });

    expect(result.cabins[0].availableSeats).toBe(180);
  });

  it('rejects a user who is not an airline moderator', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        createUser({
          role: Role.User,
        }),
      ),
    } as unknown as ReturnType<typeof userModel.findById>);

    await expect(
      service.create(userId.toString(), createDto()),
    ).rejects.toThrow('Only airline moderators can create flights');

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects an airline moderator without an airline assignment', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        createUser({
          assignment: undefined,
        }),
      ),
    } as unknown as ReturnType<typeof userModel.findById>);

    await expect(
      service.create(userId.toString(), createDto()),
    ).rejects.toThrow('You are not assigned to an airline');

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate flight numbers on the same departure date', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    flightModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    } as unknown as ReturnType<typeof flightModel.exists>);

    await expect(
      service.create(userId.toString(), createDto()),
    ).rejects.toThrow(
      'This airline already has a flight with the same flight number on this departure date',
    );

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects when arrival time is before departure time', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    const dto = createDto();
    dto.arrivalAt = '2027-01-10T09:00:00.000Z';

    await expect(service.create(userId.toString(), dto)).rejects.toThrow(
      'Arrival time must be after departure time',
    );

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects when departure and arrival airports are the same', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    const dto = createDto();
    dto.arrivalAirport = 'CAI';

    await expect(service.create(userId.toString(), dto)).rejects.toThrow(
      'Departure and arrival airports must be different',
    );

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects when booked and held seats exceed total seats', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    flightModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof flightModel.exists>);

    const dto = createDto();
    dto.cabins[0].bookedSeats = 150;
    dto.cabins[0].heldSeats = 40;

    await expect(service.create(userId.toString(), dto)).rejects.toThrow(
      'Booked and held seats cannot exceed total seats for economy',
    );

    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('calculates available seats from total, booked, and held seats', async () => {
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createUser()),
    } as unknown as ReturnType<typeof userModel.findById>);

    flightModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof flightModel.exists>);

    const dto = createDto();
    dto.cabins[0].bookedSeats = 100;
    dto.cabins[0].heldSeats = 20;

    const createdFlight = {
      _id: new Types.ObjectId(),
      airlineId,
      flightNumber: dto.flightNumber,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureAt: new Date(dto.departureAt),
      arrivalAt: new Date(dto.arrivalAt),
      departureDateLocal: dto.departureDateLocal,
      status: FlightStatus.Scheduled,
      cabins: dto.cabins,
    } as unknown as FlightDocument;

    flightModel.create.mockResolvedValue(createdFlight);

    const result = await service.create(userId.toString(), dto);

    expect(result.cabins[0].availableSeats).toBe(60);
  });
});
