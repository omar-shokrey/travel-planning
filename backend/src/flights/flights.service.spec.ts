import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/create-flight.dto';
import { DUPLICATE_FLIGHT_MESSAGE } from './flights.constants';
import { FlightsService } from './flights.service';
import { FlightStatus } from './models/flight-status.enum';

/** "Now" for every test: the rules about the past are checked against it. */
const NOW = new Date('2027-01-10T00:00:00.000Z');

const AIRPORTS: Record<string, string> = {
  CAI: 'Africa/Cairo',
  JFK: 'America/New_York',
  NRT: 'Asia/Tokyo',
  LAX: 'America/Los_Angeles',
};

const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

const dto = (fields: Partial<CreateFlightDto> = {}): CreateFlightDto => ({
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureLocal: '2027-06-15T14:30',
  arrivalLocal: '2027-06-15T18:30',
  ...fields,
});

function setup() {
  const airportsQuery = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const airports = {
    find: jest.fn((filter: { _id: { $in: string[] } }) => {
      airportsQuery.exec.mockResolvedValue(
        filter._id.$in
          .filter((code) => code in AIRPORTS)
          .map((code) => ({ _id: code, timeZone: AIRPORTS[code] })),
      );
      return airportsQuery;
    }),
  };
  const flights = {
    create: jest.fn((fields: Record<string, unknown>) =>
      Promise.resolve({
        ...fields,
        _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90456'),
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ),
  };
  const airlines = {
    findAssignedAirlineOrThrow: jest
      .fn()
      .mockResolvedValue({ _id: AIRLINE_ID, active: true }),
  };
  const service = new FlightsService(
    flights as never,
    airports as never,
    airlines as unknown as AirlinesService,
  );
  return { service, flights, airports, airlines };
}

/** The field errors of a 400, or fails when the call does not answer 400. */
async function fieldErrors(call: Promise<unknown>): Promise<FieldError[]> {
  const error: unknown = await call.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  const body = (error as BadRequestException).getResponse() as {
    message: string;
    errors: FieldError[];
  };
  expect(body.message).toBe('Validation failed');
  return body.errors;
}

describe('FlightsService.create (FLT-03)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores the local times in UTC, with the local departure date, as a scheduled flight of the moderator airline', async () => {
    const { service, flights, airlines } = setup();

    const result = await service.create(dto(), 'moderator-1');

    expect(airlines.findAssignedAirlineOrThrow).toHaveBeenCalledWith(
      'moderator-1',
    );
    expect(flights.create).toHaveBeenCalledWith({
      airlineId: AIRLINE_ID,
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: new Date('2027-06-15T11:30:00.000Z'),
      arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
      departureDateLocal: '2027-06-15',
      status: FlightStatus.Scheduled,
    });
    expect(result).toEqual({
      id: '6740f1c2a4b5c6d7e8f90456',
      airlineId: AIRLINE_ID.toString(),
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2027-06-15T11:30:00.000Z',
      arrivalAt: '2027-06-15T22:30:00.000Z',
      departureDateLocal: '2027-06-15',
      status: 'scheduled',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('reads the departure date at the departure airport, not in UTC', async () => {
    const { service, flights } = setup();

    // 07:00 in Tokyo on the 16th is 22:00 UTC on the 15th.
    await service.create(
      dto({
        departureAirport: 'NRT',
        arrivalAirport: 'LAX',
        departureLocal: '2027-06-16T07:00',
        arrivalLocal: '2027-06-16T01:00',
      }),
      'moderator-1',
    );
    // 20:00 in Los Angeles on the 15th is 03:00 UTC on the 16th.
    await service.create(
      dto({
        departureAirport: 'LAX',
        arrivalAirport: 'NRT',
        departureLocal: '2027-06-15T20:00',
        arrivalLocal: '2027-06-16T23:00',
      }),
      'moderator-1',
    );

    const [[fromTokyo], [fromLosAngeles]] = flights.create.mock.calls;
    expect(fromTokyo).toMatchObject({
      departureAt: new Date('2027-06-15T22:00:00.000Z'),
      arrivalAt: new Date('2027-06-16T08:00:00.000Z'),
      departureDateLocal: '2027-06-16',
    });
    expect(fromLosAngeles).toMatchObject({
      departureAt: new Date('2027-06-16T03:00:00.000Z'),
      departureDateLocal: '2027-06-15',
    });
  });

  it('keeps the seconds of a local time', async () => {
    const { service, flights } = setup();

    await service.create(
      dto({ departureLocal: '2027-06-15T14:30:45' }),
      'moderator-1',
    );

    expect(flights.create).toHaveBeenCalledWith(
      expect.objectContaining({
        departureAt: new Date('2027-06-15T11:30:45.000Z'),
      }),
    );
  });

  it('reads both airports in one query', async () => {
    const { service, airports } = setup();

    await service.create(dto(), 'moderator-1');

    expect(airports.find).toHaveBeenCalledTimes(1);
    expect(airports.find).toHaveBeenCalledWith({
      _id: { $in: ['CAI', 'JFK'] },
    });
  });

  it.each([
    ['departureAirport', { departureAirport: 'QQQ' }],
    ['arrivalAirport', { arrivalAirport: 'QQQ' }],
  ] as const)(
    'refuses an airport that is not in the airports list (FLT-02): %s',
    async (field, fields) => {
      const { service, flights } = setup();

      expect(await fieldErrors(service.create(dto(fields), 'm'))).toEqual([
        {
          field,
          messages: [`${field} QQQ is not in the airports list`],
        },
      ]);
      expect(flights.create).not.toHaveBeenCalled();
    },
  );

  it('refuses identical airports', async () => {
    const { service, flights } = setup();

    expect(
      await fieldErrors(
        service.create(
          dto({ arrivalAirport: 'CAI', arrivalLocal: '2027-06-15T18:30' }),
          'm',
        ),
      ),
    ).toEqual([
      {
        field: 'arrivalAirport',
        messages: ['arrivalAirport must be different from departureAirport'],
      },
    ]);
    expect(flights.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'departureLocal',
      'JFK',
      'CAI',
      { departureLocal: '2027-03-14T02:30', arrivalLocal: '2027-03-15T10:00' },
    ],
    [
      'arrivalLocal',
      'CAI',
      'JFK',
      { departureLocal: '2027-03-13T14:30', arrivalLocal: '2027-03-14T02:30' },
    ],
  ] as const)(
    'refuses %s inside the daylight saving gap of its airport (the clocks skip 02:00 to 03:00)',
    async (field, departureAirport, arrivalAirport, times) => {
      const { service, flights } = setup();

      expect(
        await fieldErrors(
          service.create(
            dto({ departureAirport, arrivalAirport, ...times }),
            'm',
          ),
        ),
      ).toEqual([
        {
          field,
          messages: [
            `${field} 2027-03-14T02:30 does not exist in America/New_York: the clocks skip that time (daylight saving change)`,
          ],
        },
      ]);
      expect(flights.create).not.toHaveBeenCalled();
    },
  );

  it('accepts a local time that happens twice (the clocks go back) as the second, standard-time instant', async () => {
    const { service, flights } = setup();

    await service.create(
      dto({
        departureAirport: 'JFK',
        arrivalAirport: 'CAI',
        departureLocal: '2027-11-07T01:30',
        arrivalLocal: '2027-11-07T19:00',
      }),
      'moderator-1',
    );

    expect(flights.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // 01:30 EST (UTC-5), not 01:30 EDT (UTC-4).
        departureAt: new Date('2027-11-07T06:30:00.000Z'),
        departureDateLocal: '2027-11-07',
      }),
    );
  });

  it('refuses an arrival whose local clock is later but whose UTC moment is earlier than the departure', async () => {
    const { service, flights } = setup();

    // 20:00 in New York is 00:00 UTC on the 16th; 01:00 in Cairo on the
    // 16th is 22:00 UTC on the 15th.
    expect(
      await fieldErrors(
        service.create(
          dto({
            departureAirport: 'JFK',
            arrivalAirport: 'CAI',
            departureLocal: '2027-06-15T20:00',
            arrivalLocal: '2027-06-16T01:00',
          }),
          'm',
        ),
      ),
    ).toEqual([
      {
        field: 'arrivalLocal',
        messages: [
          'arrivalLocal must be after departureLocal, compared in UTC',
        ],
      },
    ]);
    expect(flights.create).not.toHaveBeenCalled();
  });

  it('refuses an arrival at the same UTC moment as the departure', async () => {
    const { service } = setup();

    // 14:30 in Cairo and 07:30 in New York are both 11:30 UTC.
    expect(
      await fieldErrors(
        service.create(dto({ arrivalLocal: '2027-06-15T07:30' }), 'm'),
      ),
    ).toEqual([
      {
        field: 'arrivalLocal',
        messages: [
          'arrivalLocal must be after departureLocal, compared in UTC',
        ],
      },
    ]);
  });

  it.each([
    ['yesterday', '2027-01-09T10:00', '2027-01-09T20:00'],
    // 02:00 in Cairo on the 10th is exactly NOW (00:00 UTC).
    ['exactly now', '2027-01-10T02:00', '2027-01-10T12:00'],
  ])(
    'refuses a departure in the past (%s)',
    async (_label, departureLocal, arrivalLocal) => {
      const { service, flights } = setup();

      expect(
        await fieldErrors(
          service.create(dto({ departureLocal, arrivalLocal }), 'm'),
        ),
      ).toEqual([
        {
          field: 'departureLocal',
          messages: ['departureLocal must be in the future'],
        },
      ]);
      expect(flights.create).not.toHaveBeenCalled();
    },
  );

  it('accepts a departure one minute in the future', async () => {
    const { service, flights } = setup();

    // 02:01 in Cairo on the 10th is one minute after NOW.
    await service.create(
      dto({
        departureLocal: '2027-01-10T02:01',
        arrivalLocal: '2027-01-10T12:00',
      }),
      'm',
    );

    expect(flights.create).toHaveBeenCalledTimes(1);
  });

  it('lists several broken rules in one 400, in the order of the fields', async () => {
    const { service, flights } = setup();

    const unknownAndIdentical = await fieldErrors(
      service.create(
        dto({ departureAirport: 'QQQ', arrivalAirport: 'QQQ' }),
        'm',
      ),
    );
    const pastAndBackwards = await fieldErrors(
      service.create(
        dto({
          departureLocal: '2026-12-01T10:00',
          arrivalLocal: '2026-12-01T01:00',
        }),
        'm',
      ),
    );

    expect(unknownAndIdentical).toEqual([
      {
        field: 'departureAirport',
        messages: ['departureAirport QQQ is not in the airports list'],
      },
      {
        field: 'arrivalAirport',
        messages: [
          'arrivalAirport QQQ is not in the airports list',
          'arrivalAirport must be different from departureAirport',
        ],
      },
    ]);
    expect(pastAndBackwards).toEqual([
      {
        field: 'departureLocal',
        messages: ['departureLocal must be in the future'],
      },
      {
        field: 'arrivalLocal',
        messages: [
          'arrivalLocal must be after departureLocal, compared in UTC',
        ],
      },
    ]);
    expect(flights.create).not.toHaveBeenCalled();
  });

  it('answers 409 when the unique index refuses the insert (E11000), with no check before the insert', async () => {
    const { service, flights } = setup();
    flights.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
    );

    const error: unknown = await service
      .create(dto(), 'm')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(DUPLICATE_FLIGHT_MESSAGE);
    expect(flights.create).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other database error', async () => {
    const { service, flights } = setup();
    const failure = Object.assign(new Error('connection lost'), { code: 91 });
    flights.create.mockRejectedValueOnce(failure);

    await expect(service.create(dto(), 'm')).rejects.toBe(failure);
  });

  it('answers 403 for an airline moderator with no assigned airline, before any lookup', async () => {
    const { service, flights, airports, airlines } = setup();
    airlines.findAssignedAirlineOrThrow.mockRejectedValueOnce(
      new ForbiddenException('You are not assigned to an airline'),
    );

    await expect(service.create(dto(), 'm')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(airports.find).not.toHaveBeenCalled();
    expect(flights.create).not.toHaveBeenCalled();
  });

  it('lets the moderator of a deactivated airline create flights (ACC-15 only hides it)', async () => {
    const { service, flights, airlines } = setup();
    airlines.findAssignedAirlineOrThrow.mockResolvedValueOnce({
      _id: AIRLINE_ID,
      active: false,
    });

    await service.create(dto(), 'm');

    expect(flights.create).toHaveBeenCalledTimes(1);
  });
});
