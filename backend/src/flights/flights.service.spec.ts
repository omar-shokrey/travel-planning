import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/create-flight.dto';
import type { UpdateFlightDto } from './dto/update-flight.dto';
import type { FlightBookingLookup } from './flight-booking-lookup.service';
import { FlightResponsesService } from './flight-responses.service';
import {
  AIRPORTS_LOCKED_MESSAGE,
  DUPLICATE_FLIGHT_MESSAGE,
  EMPTY_FLIGHT_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { FlightsService } from './flights.service';
import { FlightStatus } from './models/flight-status.enum';

/** "Now" for every test: the rules about the past are checked against it. */
const NOW = new Date('2027-01-10T00:00:00.000Z');

const AIRPORTS: Record<string, string> = {
  CAI: 'Africa/Cairo',
  JFK: 'America/New_York',
  NRT: 'Asia/Tokyo',
  LAX: 'America/Los_Angeles',
  SYD: 'Australia/Sydney',
  SIN: 'Asia/Singapore',
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
    airlines as unknown as AirlinesService,
    new FlightResponsesService(airports as never),
    {} as FlightBookingLookup,
    {} as NotificationsService,
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
      // GEN-06: what the moderator typed comes back, with each airport's
      // zone and its offset at that moment.
      departureLocal: '2027-06-15T14:30',
      departureTimeZone: 'Africa/Cairo',
      departureUtcOffset: '+03:00',
      arrivalLocal: '2027-06-15T18:30',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
      departureDateLocal: '2027-06-15',
      status: 'scheduled',
      // A new flight has no cabin yet (FLT-04).
      cabins: [],
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

  // luxon's own guess follows the offset of the current moment, so each case
  // runs once in a northern winter and once in a northern summer.
  it.each([
    ['January', '2027-01-10T00:00:00.000Z'],
    ['July', '2026-07-01T00:00:00.000Z'],
  ])(
    'accepts a local time that happens twice (the clocks go back) as the second, standard-time instant, also when asked in %s',
    async (_month, now) => {
      jest.setSystemTime(new Date(now));
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
      // Sydney goes back in April (southern autumn): 02:30 happens twice.
      await service.create(
        dto({
          departureAirport: 'SYD',
          arrivalAirport: 'NRT',
          departureLocal: '2027-04-04T02:30',
          arrivalLocal: '2027-04-04T11:00',
        }),
        'moderator-1',
      );

      const [[fromNewYork], [fromSydney]] = flights.create.mock.calls;
      expect(fromNewYork).toMatchObject({
        // 01:30 EST (UTC-5), not 01:30 EDT (UTC-4).
        departureAt: new Date('2027-11-07T06:30:00.000Z'),
        departureDateLocal: '2027-11-07',
      });
      expect(fromSydney).toMatchObject({
        // 02:30 AEST (UTC+10), not 02:30 AEDT (UTC+11).
        departureAt: new Date('2027-04-03T16:30:00.000Z'),
        departureDateLocal: '2027-04-04',
      });
    },
  );

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

const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const OTHER_AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');

/**
 * The flight as stored: CAI 14:30 (UTC+3 in June) to JFK 18:30 (UTC-4),
 * scheduled, with one economy cabin.
 */
const storedFlight = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(FLIGHT_ID),
  airlineId: AIRLINE_ID,
  status: FlightStatus.Scheduled,
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  cabins: [
    {
      _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
      cabin: 'economy',
      totalSeats: 100,
      bookedSeats: 0,
      heldSeats: 0,
      price: 25000,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

/**
 * The edit's collaborators. `reads` are the answers of the flight reads, in
 * order: `findById` (the state the rules check), then `findOneAndUpdate` (the
 * flight as written) or, when `writeFindsNothing()` made the write match nothing,
 * `findById` again (the state read to tell why).
 */
function editSetup(...reads: unknown[]) {
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
  const queue = [...reads];
  const flights = {
    findById: jest.fn(() => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(() => Promise.resolve(queue.shift() ?? null)),
      };
      return query;
    }),
    findOneAndUpdate: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(() => Promise.resolve(queue.shift() ?? null)),
    })),
  };
  const airlines = {
    findAssignedAirlineOrThrow: jest
      .fn()
      .mockResolvedValue({ _id: AIRLINE_ID, active: true }),
  };
  const bookings = {
    hasActiveBooking: jest.fn().mockResolvedValue(false),
    confirmedUserIds: jest.fn().mockResolvedValue([]),
  };
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
  const service = new FlightsService(
    flights as never,
    airlines as unknown as AirlinesService,
    new FlightResponsesService(airports as never),
    bookings as unknown as FlightBookingLookup,
    notifications as unknown as NotificationsService,
  );
  /** The filter and the update of the one write. */
  const write = () => {
    expect(flights.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = flights.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { $and: Record<string, unknown>[] },
      { $set: Record<string, unknown> },
      unknown,
    ];
    return { filter, update, options };
  };
  /** Makes the one write find no flight to change, or fail with `error`. */
  const writeFindsNothing = (error?: unknown) =>
    flights.findOneAndUpdate.mockReturnValueOnce({
      lean: jest.fn().mockReturnThis(),
      exec: error
        ? jest.fn().mockRejectedValue(error)
        : jest.fn().mockResolvedValue(null),
    });
  return {
    service,
    flights,
    airports,
    airlines,
    bookings,
    notifications,
    write,
    writeFindsNothing,
  };
}

/** The filter of a write that leaves the airports as they are. */
const timesOnlyFilter = (now: Date) => ({
  $and: [
    { _id: new Types.ObjectId(FLIGHT_ID), airlineId: AIRLINE_ID },
    { status: FlightStatus.Scheduled, departureAt: { $gt: now } },
    {
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: new Date('2027-06-15T11:30:00.000Z'),
      arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
    },
  ],
});

const NO_SEATS_TAKEN = {
  $nor: [
    { 'cabins.bookedSeats': { $gt: 0 } },
    { 'cabins.heldSeats': { $gt: 0 } },
  ],
};

const edit = (
  service: FlightsService,
  body: UpdateFlightDto,
  flightId = FLIGHT_ID,
) => service.update(flightId, body, 'moderator-1');

describe('FlightsService.update (FLT-05)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the times', () => {
    it('stores a new local departure in UTC, keeps the rest, and answers the flight', async () => {
      const after = storedFlight({
        departureAt: new Date('2027-06-15T13:30:00.000Z'),
      });
      const { service, write, airlines } = editSetup(storedFlight(), after);

      const result = await edit(service, {
        departureLocal: '2027-06-15T16:30',
      });

      expect(airlines.findAssignedAirlineOrThrow).toHaveBeenCalledWith(
        'moderator-1',
      );
      const { filter, update, options } = write();
      expect(filter).toEqual(timesOnlyFilter(NOW));
      expect(update).toEqual({
        $set: {
          departureAirport: 'CAI',
          arrivalAirport: 'JFK',
          departureAt: new Date('2027-06-15T13:30:00.000Z'),
          arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
          departureDateLocal: '2027-06-15',
        },
      });
      expect(options).toEqual({ returnDocument: 'after', runValidators: true });
      expect(result).toMatchObject({
        id: FLIGHT_ID,
        departureAt: '2027-06-15T13:30:00.000Z',
        departureLocal: '2027-06-15T16:30',
        departureTimeZone: 'Africa/Cairo',
        arrivalLocal: '2027-06-15T18:30',
        departureDateLocal: '2027-06-15',
        status: 'scheduled',
      });
      expect(result.cabins).toHaveLength(1);
    });

    it('reads the arrival in the arrival airport time zone', async () => {
      const { service, write } = editSetup(storedFlight(), storedFlight());

      await edit(service, { arrivalLocal: '2027-06-15T20:45' });

      // 20:45 in New York (UTC-4) is 00:45 UTC the next day.
      expect(write().update.$set).toMatchObject({
        departureAt: new Date('2027-06-15T11:30:00.000Z'),
        arrivalAt: new Date('2027-06-16T00:45:00.000Z'),
      });
    });

    it('recomputes the local departure date when the new time crosses midnight at an airport ahead of UTC', async () => {
      // SIN is UTC+8: 23:00 on the 15th is 15:00 UTC.
      const fromSingapore = storedFlight({
        departureAirport: 'SIN',
        departureAt: new Date('2027-06-15T15:00:00.000Z'),
        arrivalAt: new Date('2027-06-16T10:00:00.000Z'),
      });
      const { service, write } = editSetup(fromSingapore, fromSingapore);

      // 00:30 on the 16th in Singapore is still the 15th in UTC (16:30).
      await edit(service, { departureLocal: '2027-06-16T00:30' });

      expect(write().update.$set).toMatchObject({
        departureAt: new Date('2027-06-15T16:30:00.000Z'),
        departureDateLocal: '2027-06-16',
      });
    });

    it('refuses a departure in the past, as FLT-03 does', async () => {
      const { service, flights } = editSetup(storedFlight());

      // NOW is 2027-01-10 00:00 UTC, 02:00 in Cairo.
      expect(
        await fieldErrors(
          edit(service, { departureLocal: '2027-01-10T01:59' }),
        ),
      ).toEqual([
        {
          field: 'departureLocal',
          messages: ['departureLocal must be in the future'],
        },
      ]);
      expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses a new arrival not after the stored departure, on arrivalLocal', async () => {
      const { service } = editSetup(storedFlight());

      // 07:30 in New York is 11:30 UTC: the same instant as the departure.
      expect(
        await fieldErrors(edit(service, { arrivalLocal: '2027-06-15T07:30' })),
      ).toEqual([
        {
          field: 'arrivalLocal',
          messages: [
            'arrivalLocal must be after departureLocal, compared in UTC',
          ],
        },
      ]);
    });

    it('refuses a new departure not before the stored arrival, on departureLocal', async () => {
      const { service } = editSetup(storedFlight());

      // 01:30 on the 16th in Cairo is 22:30 UTC: the stored arrival.
      expect(
        await fieldErrors(
          edit(service, { departureLocal: '2027-06-16T01:30' }),
        ),
      ).toEqual([
        {
          field: 'departureLocal',
          messages: [
            'departureLocal must be before the arrival, compared in UTC',
          ],
        },
      ]);
    });

    it('accepts a new departure and arrival that are only in order together', async () => {
      const { service, write } = editSetup(storedFlight(), storedFlight());

      await edit(service, {
        departureLocal: '2027-06-16T08:00',
        arrivalLocal: '2027-06-16T15:00',
      });

      expect(write().update.$set).toMatchObject({
        departureAt: new Date('2027-06-16T05:00:00.000Z'),
        arrivalAt: new Date('2027-06-16T19:00:00.000Z'),
        departureDateLocal: '2027-06-16',
      });
    });

    it('refuses a local time inside a daylight saving gap', async () => {
      // New York skips 02:00-03:00 on 2027-03-14.
      const { service } = editSetup(storedFlight());

      const errors = await fieldErrors(
        edit(service, { arrivalLocal: '2027-03-14T02:30' }),
      );
      expect(errors).toEqual([
        {
          field: 'arrivalLocal',
          messages: [
            'arrivalLocal 2027-03-14T02:30 does not exist in America/New_York: the clocks skip that time (daylight saving change)',
          ],
        },
      ]);
    });
  });

  describe('the airports', () => {
    it('changes an airport when the flight has no booking: the lookup first, then a write that requires no seat booked or held', async () => {
      const after = storedFlight({ departureAirport: 'NRT' });
      const { service, write, bookings, airports, flights } = editSetup(
        storedFlight(),
        after,
      );

      const result = await edit(service, { departureAirport: 'NRT' });

      expect(bookings.hasActiveBooking).toHaveBeenCalledWith(FLIGHT_ID);
      const { filter, update } = write();
      expect(filter).toEqual({
        $and: [...timesOnlyFilter(NOW).$and, NO_SEATS_TAKEN],
      });
      expect(
        bookings.hasActiveBooking.mock.invocationCallOrder[0],
      ).toBeLessThan(flights.findOneAndUpdate.mock.invocationCallOrder[0]);
      // The instants stay; the local date is read at the new airport:
      // 11:30 UTC is 20:30 in Tokyo, still the 15th.
      expect(update.$set).toEqual({
        departureAirport: 'NRT',
        arrivalAirport: 'JFK',
        departureAt: new Date('2027-06-15T11:30:00.000Z'),
        arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
        departureDateLocal: '2027-06-15',
      });
      // The old and the new airports' zones in one query.
      expect(airports.find).toHaveBeenCalledTimes(1);
      expect(airports.find).toHaveBeenCalledWith({
        _id: { $in: ['CAI', 'JFK', 'NRT'] },
      });
      expect(result).toMatchObject({
        departureAirport: 'NRT',
        departureTimeZone: 'Asia/Tokyo',
        departureLocal: '2027-06-15T20:30',
      });
    });

    it('recomputes the local date at the new departure airport', async () => {
      const lateUtc = storedFlight({
        departureAt: new Date('2027-06-15T20:00:00.000Z'),
        arrivalAt: new Date('2027-06-16T08:00:00.000Z'),
      });
      const { service, write } = editSetup(lateUtc, lateUtc);

      // 20:00 UTC is 23:00 in Cairo (the 15th) and 04:00 in Singapore (the 16th).
      await edit(service, { departureAirport: 'SIN' });

      expect(write().update.$set).toMatchObject({
        departureAirport: 'SIN',
        departureDateLocal: '2027-06-16',
      });
    });

    it('reads a new local time in the new airport time zone', async () => {
      const { service, write } = editSetup(storedFlight(), storedFlight());

      await edit(service, {
        departureAirport: 'NRT',
        departureLocal: '2027-06-15T20:00',
      });

      // 20:00 in Tokyo (UTC+9) is 11:00 UTC.
      expect(write().update.$set).toMatchObject({
        departureAirport: 'NRT',
        departureAt: new Date('2027-06-15T11:00:00.000Z'),
      });
    });

    it('refuses to change the airports while a booking waits for its payment or is confirmed (409), before any write', async () => {
      const { service, flights, bookings } = editSetup(storedFlight());
      bookings.hasActiveBooking.mockResolvedValueOnce(true);

      await expect(edit(service, { arrivalAirport: 'LAX' })).rejects.toThrow(
        new ConflictException(AIRPORTS_LOCKED_MESSAGE),
      );
      expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      ['booked', { bookedSeats: 1, heldSeats: 0 }],
      ['held', { bookedSeats: 0, heldSeats: 1 }],
    ])(
      'answers 409 when the write matched nothing because a seat is %s',
      async (_label, counters) => {
        const taken = storedFlight({
          cabins: [{ ...storedFlight().cabins[0], ...counters }],
        });
        const { service, writeFindsNothing } = editSetup(storedFlight(), taken);
        writeFindsNothing();

        await expect(
          edit(service, { departureAirport: 'NRT' }),
        ).rejects.toThrow(new ConflictException(AIRPORTS_LOCKED_MESSAGE));
      },
    );

    it('treats the airport the flight already has as no change: no lookup and no seat condition', async () => {
      const { service, write, bookings } = editSetup(
        storedFlight({
          cabins: [{ ...storedFlight().cabins[0], bookedSeats: 40 }],
        }),
        storedFlight(),
      );

      await edit(service, {
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocal: '2027-06-15T16:30',
      });

      expect(bookings.hasActiveBooking).not.toHaveBeenCalled();
      expect(write().filter).toEqual(timesOnlyFilter(NOW));
    });

    it('changes the times of a booked flight: the seat condition is only for the airports', async () => {
      const booked = storedFlight({
        cabins: [
          { ...storedFlight().cabins[0], bookedSeats: 40, heldSeats: 2 },
        ],
      });
      const { service, write, bookings } = editSetup(booked, booked);

      await edit(service, { departureLocal: '2027-06-15T16:30' });

      expect(bookings.hasActiveBooking).not.toHaveBeenCalled();
      expect(write().filter).toEqual(timesOnlyFilter(NOW));
    });

    it('refuses an airport that is not in the airports list, on its field', async () => {
      const { service } = editSetup(storedFlight());

      expect(
        await fieldErrors(edit(service, { arrivalAirport: 'QQQ' })),
      ).toEqual([
        {
          field: 'arrivalAirport',
          messages: ['arrivalAirport QQQ is not in the airports list'],
        },
      ]);
    });

    it('refuses identical airports, on the field that was sent', async () => {
      const { service } = editSetup(storedFlight(), storedFlight());

      expect(
        await fieldErrors(edit(service, { arrivalAirport: 'CAI' })),
      ).toEqual([
        {
          field: 'arrivalAirport',
          messages: ['arrivalAirport must be different from departureAirport'],
        },
      ]);
      expect(
        await fieldErrors(edit(service, { departureAirport: 'JFK' })),
      ).toEqual([
        {
          field: 'departureAirport',
          messages: ['departureAirport must be different from arrivalAirport'],
        },
      ]);
    });

    it('lists several broken rules in one 400, in the order of the fields', async () => {
      const { service } = editSetup(storedFlight());

      const errors = await fieldErrors(
        edit(service, {
          departureAirport: 'QQQ',
          arrivalLocal: '2027-06-15T07:30',
        }),
      );
      expect(errors.map((error) => error.field)).toEqual([
        'departureAirport',
        'arrivalLocal',
      ]);
    });
  });

  describe('who and which flight: the answers of the cabin routes (FLT-04)', () => {
    it('answers 400 to an empty body before anything is read', async () => {
      const { service, airlines, flights } = editSetup();

      await expect(edit(service, {})).rejects.toThrow(
        new BadRequestException(EMPTY_FLIGHT_UPDATE_MESSAGE),
      );
      expect(airlines.findAssignedAirlineOrThrow).not.toHaveBeenCalled();
      expect(flights.findById).not.toHaveBeenCalled();
    });

    it('answers 403 to a moderator with no airline, before the flight is read', async () => {
      const { service, airlines, flights } = editSetup();
      airlines.findAssignedAirlineOrThrow.mockRejectedValueOnce(
        new ForbiddenException('You are not assigned to an airline'),
      );

      await expect(
        edit(service, { departureLocal: '2027-06-15T16:30' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(flights.findById).not.toHaveBeenCalled();
    });

    it.each([
      ['no flight', null, new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE)],
      [
        "another airline's flight",
        storedFlight({ airlineId: OTHER_AIRLINE_ID }),
        new ForbiddenException(FOREIGN_FLIGHT_MESSAGE),
      ],
      [
        'a cancelled flight',
        storedFlight({ status: FlightStatus.Cancelled }),
        new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
      ],
      [
        'a departed flight',
        storedFlight({ status: FlightStatus.Departed }),
        new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
      ],
      [
        'a flight still stored as scheduled whose departure has passed (FLT-30)',
        storedFlight({ departureAt: new Date(NOW.getTime() - 60_000) }),
        new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
      ],
    ])(
      'answers %s before any rule or write',
      async (_label, flight, answer) => {
        const { service, flights, airports, bookings } = editSetup(flight);

        await expect(
          edit(service, { departureAirport: 'NRT' }),
        ).rejects.toThrow(answer);
        expect(airports.find).not.toHaveBeenCalled();
        expect(bookings.hasActiveBooking).not.toHaveBeenCalled();
        expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'cancelled in between',
        storedFlight({ status: FlightStatus.Cancelled }),
        new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
      ],
      [
        'changed by another request in between',
        storedFlight({ arrivalAt: new Date('2027-06-15T23:30:00.000Z') }),
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      ],
    ])(
      'reads the flight again when the write matched nothing: %s',
      async (_label, current, answer) => {
        const { service, writeFindsNothing, notifications } = editSetup(
          storedFlight(),
          current,
        );
        writeFindsNothing();

        await expect(
          edit(service, { departureLocal: '2027-06-15T16:30' }),
        ).rejects.toThrow(answer);
        expect(notifications.notifyMany).not.toHaveBeenCalled();
      },
    );

    it('answers 409 when the new local date clashes with the same flight number (E11000)', async () => {
      const { service, writeFindsNothing } = editSetup(storedFlight());
      writeFindsNothing({ code: 11000 });

      await expect(
        edit(service, {
          departureLocal: '2027-06-16T14:30',
          arrivalLocal: '2027-06-16T18:30',
        }),
      ).rejects.toThrow(new ConflictException(DUPLICATE_FLIGHT_MESSAGE));
    });

    it('rethrows any other database error', async () => {
      const failure = new Error('connection lost');
      const { service, writeFindsNothing } = editSetup(storedFlight());
      writeFindsNothing(failure);

      await expect(
        edit(service, { departureLocal: '2027-06-15T16:30' }),
      ).rejects.toBe(failure);
    });
  });

  describe('the notification of a time change (GEN-01)', () => {
    const userA = new Types.ObjectId('6740f1c2a4b5c6d7e8f9a001');
    const userB = new Types.ObjectId('6740f1c2a4b5c6d7e8f9a002');

    it('notifies the users with a confirmed booking once, after the write, with the old and new local times', async () => {
      const { service, flights, bookings, notifications } = editSetup(
        storedFlight(),
        storedFlight({ departureAt: new Date('2027-06-15T13:30:00.000Z') }),
      );
      bookings.confirmedUserIds.mockResolvedValueOnce([userA, userB]);

      await edit(service, { departureLocal: '2027-06-15T16:30' });

      expect(bookings.confirmedUserIds).toHaveBeenCalledWith(FLIGHT_ID);
      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMany).toHaveBeenCalledWith(
        [userA, userB],
        'flight_changed',
        'Flight MS123 from CAI to JFK has new times. Departure: 2027-06-15 16:30 CAI time (was 2027-06-15 14:30). Arrival: 2027-06-15 18:30 JFK time (unchanged).',
        { type: 'flight', id: FLIGHT_ID },
      );
      expect(flights.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        bookings.confirmedUserIds.mock.invocationCallOrder[0],
      );
    });

    it('notifies for a new arrival time alone', async () => {
      const { service, bookings, notifications } = editSetup(
        storedFlight(),
        storedFlight(),
      );
      bookings.confirmedUserIds.mockResolvedValueOnce([userA]);

      await edit(service, { arrivalLocal: '2027-06-15T19:00' });

      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the same local time again', { departureLocal: '2027-06-15T14:30' }],
      ['the same time with seconds', { arrivalLocal: '2027-06-15T18:30:00' }],
      ['only a new airport', { arrivalAirport: 'LAX' }],
    ])('sends nothing when no instant changed: %s', async (_label, body) => {
      const { service, bookings, notifications } = editSetup(
        storedFlight(),
        storedFlight(),
      );
      bookings.confirmedUserIds.mockResolvedValue([userA]);

      await edit(service, body);

      expect(bookings.confirmedUserIds).not.toHaveBeenCalled();
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });

    it('treats a time as changed only when its minute changes, as every response and notification shows it', async () => {
      // Stored with seconds: 14:30:45 in Cairo, shown as 14:30 everywhere.
      const withSeconds = storedFlight({
        departureAt: new Date('2027-06-15T11:30:45.000Z'),
      });
      const same = editSetup(withSeconds, withSeconds);
      same.bookings.confirmedUserIds.mockResolvedValue([userA]);
      const moved = editSetup(withSeconds, withSeconds);
      moved.bookings.confirmedUserIds.mockResolvedValue([userA]);

      await edit(same.service, { departureLocal: '2027-06-15T14:30' });
      await edit(moved.service, { departureLocal: '2027-06-15T14:31' });

      // The exact time sent is stored either way.
      expect(same.write().update.$set.departureAt).toEqual(
        new Date('2027-06-15T11:30:00.000Z'),
      );
      expect(same.notifications.notifyMany).not.toHaveBeenCalled();
      expect(moved.notifications.notifyMany).toHaveBeenCalledWith(
        [userA],
        'flight_changed',
        'Flight MS123 from CAI to JFK has new times. Departure: 2027-06-15 14:31 CAI time (was 2027-06-15 14:30). Arrival: 2027-06-15 18:30 JFK time (unchanged).',
        { type: 'flight', id: FLIGHT_ID },
      );
    });

    it('sends nothing when nobody has a confirmed booking, and still succeeds', async () => {
      const { service, bookings, notifications } = editSetup(
        storedFlight(),
        storedFlight(),
      );

      await expect(
        edit(service, { departureLocal: '2027-06-15T16:30' }),
      ).resolves.toMatchObject({ id: FLIGHT_ID });
      expect(bookings.confirmedUserIds).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });

    it('logs a failure with the flight id only and still answers the changed flight', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { service, bookings, notifications } = editSetup(
        storedFlight(),
        storedFlight({ departureAt: new Date('2027-06-15T13:30:00.000Z') }),
      );
      bookings.confirmedUserIds.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        edit(service, { departureLocal: '2027-06-15T16:30' }),
      ).resolves.toMatchObject({ departureLocal: '2027-06-15T16:30' });
      expect(notifications.notifyMany).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        `Could not notify the passengers of flight ${FLIGHT_ID} about its new times`,
        expect.any(String),
      );
    });
  });
});
