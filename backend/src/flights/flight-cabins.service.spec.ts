import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { AirlinesService } from './airlines.service';
import type { CreateCabinDto } from './dto/create-cabin.dto';
import { FlightCabinsService } from './flight-cabins.service';
import { FlightResponsesService } from './flight-responses.service';
import {
  CABIN_CHANGED_MESSAGE,
  CABIN_NOT_FOUND_MESSAGE,
  CABIN_UPDATE_ATTEMPTS,
  EMPTY_CABIN_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { CabinClass } from './models/cabin-class.enum';
import { FlightStatus } from './models/flight-status.enum';

const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const OTHER_AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const CABIN_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');
const UNKNOWN_CABIN_ID = '6740f1c2a4b5c6d7e8f90000';

/** "Now" for every test (FLT-30): the stored flight below departs months later. */
const NOW = new Date('2027-01-10T00:00:00.000Z');
/** A departure that has passed at NOW, for a flight still stored as scheduled. */
const PAST = new Date('2027-01-09T23:59:59.999Z');

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

const dto = (fields: Partial<CreateCabinDto> = {}): CreateCabinDto => ({
  cabin: CabinClass.Business,
  totalSeats: 30,
  price: 150000,
  freeBags: 2,
  maxBagKg: 32,
  ...fields,
});

/** A stored economy cabin with 10 seats booked and 5 held. */
const economy = (fields: Record<string, unknown> = {}) => ({
  _id: CABIN_ID,
  cabin: CabinClass.Economy,
  totalSeats: 180,
  bookedSeats: 10,
  heldSeats: 5,
  price: 25000,
  freeBags: 1,
  maxBagKg: 23,
  ...fields,
});

const stored = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(FLIGHT_ID),
  airlineId: AIRLINE_ID,
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
  cabins: [economy()],
  createdAt: new Date('2026-11-18T10:00:00.000Z'),
  updatedAt: new Date('2026-11-18T10:05:00.000Z'),
  ...fields,
});

function setup() {
  /** What each `findById(...).exec()` resolves to, in order. */
  const reads: unknown[] = [];
  /** What each `updateOne(...).exec()` reports as `matchedCount`, in order (default 1). */
  const matches: number[] = [];
  /** What each `updateOne(...).exec()` reports as `modifiedCount`, in order (default 1). */
  const modified: number[] = [];
  const selects: unknown[] = [];
  const flights = {
    updateOne: jest.fn(() => ({
      exec: jest.fn(() =>
        Promise.resolve({
          matchedCount: matches.shift() ?? 1,
          modifiedCount: modified.shift() ?? 1,
        }),
      ),
    })),
    findById: jest.fn(() => {
      interface Query {
        select: jest.Mock<Query, [unknown]>;
        lean: jest.Mock<Query, []>;
        exec: jest.Mock<Promise<unknown>, []>;
      }
      const query: Query = {
        select: jest.fn((fields: unknown) => {
          selects.push(fields);
          return query;
        }),
        lean: jest.fn(() => query),
        exec: jest.fn(() => Promise.resolve(reads.shift() ?? null)),
      };
      return query;
    }),
  };
  const airlines = {
    findAssignedAirlineOrThrow: jest
      .fn()
      .mockResolvedValue({ _id: AIRLINE_ID, active: true }),
  };
  /** The airports of the stored flight with their zones (GEN-06). */
  const airports = {
    find: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { _id: 'CAI', timeZone: 'Africa/Cairo' },
        { _id: 'JFK', timeZone: 'America/New_York' },
      ]),
    })),
  };
  const service = new FlightCabinsService(
    flights as never,
    airlines as unknown as AirlinesService,
    new FlightResponsesService(airports as never),
  );
  return {
    service,
    flights,
    airlines,
    airports,
    reads,
    matches,
    modified,
    selects,
  };
}

/** The error a call rejects with, or fails when it resolves. */
async function failureOf(call: Promise<unknown>): Promise<Error> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe('FlightCabinsService.addCabin (FLT-04)', () => {
  it('pushes the cabin in one conditional write: own airline, scheduled, class not yet present', async () => {
    const { service, flights, airlines, reads } = setup();
    reads.push(
      stored({
        cabins: [
          economy(),
          {
            ...economy(),
            _id: new Types.ObjectId(),
            cabin: CabinClass.Business,
          },
        ],
      }),
    );

    const result = await service.addCabin(FLIGHT_ID, dto(), 'moderator-1');

    expect(airlines.findAssignedAirlineOrThrow).toHaveBeenCalledWith(
      'moderator-1',
    );
    expect(flights.updateOne).toHaveBeenCalledTimes(1);
    expect(flights.updateOne).toHaveBeenCalledWith(
      {
        _id: FLIGHT_ID,
        airlineId: AIRLINE_ID,
        // scheduledFlightFilter(now) (FLT-30), in the write itself.
        status: FlightStatus.Scheduled,
        departureAt: { $gt: NOW },
        'cabins.cabin': { $ne: CabinClass.Business },
      },
      {
        $push: {
          cabins: {
            _id: expect.any(Types.ObjectId),
            cabin: CabinClass.Business,
            totalSeats: 30,
            bookedSeats: 0,
            heldSeats: 0,
            price: 150000,
            freeBags: 2,
            maxBagKg: 32,
          },
        },
      },
      { runValidators: true },
    );
    expect(result.cabins.map((cabin) => cabin.cabin)).toEqual([
      'economy',
      'business',
    ]);
    expect(result.id).toBe(FLIGHT_ID);
  });

  it('returns the flight with its local times, reading both airport zones in one query (GEN-06)', async () => {
    const { service, airports, reads } = setup();
    reads.push(stored());

    const result = await service.addCabin(FLIGHT_ID, dto(), 'moderator-1');

    expect(airports.find).toHaveBeenCalledTimes(1);
    expect(airports.find).toHaveBeenCalledWith({
      _id: { $in: ['CAI', 'JFK'] },
    });
    expect(result).toMatchObject({
      departureAt: '2027-06-15T11:30:00.000Z',
      arrivalAt: '2027-06-15T22:30:00.000Z',
      departureLocal: '2027-06-15T14:30',
      departureTimeZone: 'Africa/Cairo',
      arrivalLocal: '2027-06-15T18:30',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
    });
  });

  it('gives every new cabin a new id, and starts its counters at 0 whatever the request', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored(), stored());

    await service.addCabin(FLIGHT_ID, dto(), 'moderator-1');
    await service.addCabin(
      FLIGHT_ID,
      { ...dto(), bookedSeats: 9, heldSeats: 9 } as CreateCabinDto,
      'moderator-1',
    );

    const pushed = (
      flights.updateOne.mock.calls as unknown as [
        unknown,
        { $push: { cabins: Record<string, unknown> } },
      ][]
    ).map(([, update]) => update.$push.cabins);
    expect(pushed[0]._id).not.toEqual(pushed[1]._id);
    expect(pushed[1]).toMatchObject({ bookedSeats: 0, heldSeats: 0 });
    expect(Object.keys(pushed[1]).sort()).toEqual([
      '_id',
      'bookedSeats',
      'cabin',
      'freeBags',
      'heldSeats',
      'maxBagKg',
      'price',
      'totalSeats',
    ]);
  });

  it('writes nothing when the moderator has no airline', async () => {
    const { service, flights, airlines } = setup();
    airlines.findAssignedAirlineOrThrow.mockRejectedValue(
      new ForbiddenException('You are not assigned to an airline'),
    );

    await expect(
      service.addCabin(FLIGHT_ID, dto(), 'moderator-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  describe('when the write matched nothing, one read tells why', () => {
    it.each([
      [
        'the flight does not exist',
        null,
        NotFoundException,
        FLIGHT_NOT_FOUND_MESSAGE,
      ],
      [
        'the flight belongs to another airline',
        stored({ airlineId: OTHER_AIRLINE_ID }),
        ForbiddenException,
        FOREIGN_FLIGHT_MESSAGE,
      ],
      [
        'the flight is cancelled',
        stored({ status: FlightStatus.Cancelled }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
      [
        'the flight is departed',
        stored({ status: FlightStatus.Departed }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
      [
        'the departure time has passed, the stored status is still scheduled (FLT-30)',
        stored({ departureAt: PAST }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
      [
        'the flight departs at this very instant (FLT-30)',
        stored({ departureAt: NOW }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
      [
        'the flight already has this class',
        stored({ cabins: [economy({ cabin: CabinClass.Business })] }),
        ConflictException,
        'This flight already has a business cabin',
      ],
      [
        'none of these (it changed in between)',
        stored(),
        ConflictException,
        FLIGHT_CHANGED_MESSAGE,
      ],
    ])('%s', async (_case, flight, type, message) => {
      const { service, flights, reads, matches, selects } = setup();
      matches.push(0);
      reads.push(flight);

      const error = await failureOf(
        service.addCabin(FLIGHT_ID, dto(), 'moderator-1'),
      );

      expect(error).toBeInstanceOf(type);
      expect(error.message).toBe(message);
      // One read, of the fields the checks need; no second write.
      expect(flights.findById).toHaveBeenCalledTimes(1);
      expect(flights.findById).toHaveBeenCalledWith(FLIGHT_ID);
      expect(selects).toEqual(['airlineId status departureAt cabins']);
      expect(flights.updateOne).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'another airline before not scheduled and the class',
        stored({
          airlineId: OTHER_AIRLINE_ID,
          status: FlightStatus.Cancelled,
          cabins: [economy({ cabin: CabinClass.Business })],
        }),
        ForbiddenException,
        FOREIGN_FLIGHT_MESSAGE,
      ],
      [
        'a passed departure before the class (FLT-30)',
        stored({
          departureAt: PAST,
          cabins: [economy({ cabin: CabinClass.Business })],
        }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
      [
        'not scheduled before the class',
        stored({
          status: FlightStatus.Cancelled,
          cabins: [economy({ cabin: CabinClass.Business })],
        }),
        ConflictException,
        FLIGHT_NOT_SCHEDULED_MESSAGE,
      ],
    ])('checks %s', async (_case, flight, type, message) => {
      const { service, reads, matches } = setup();
      matches.push(0);
      reads.push(flight);

      const error = await failureOf(
        service.addCabin(FLIGHT_ID, dto(), 'moderator-1'),
      );

      expect(error).toBeInstanceOf(type);
      expect(error.message).toBe(message);
    });
  });

  it.each([
    [CabinClass.Economy, 'This flight already has an economy cabin'],
    [
      CabinClass.PremiumEconomy,
      'This flight already has a premium_economy cabin',
    ],
    [CabinClass.Business, 'This flight already has a business cabin'],
    [CabinClass.First, 'This flight already has a first cabin'],
  ])('names the class in the duplicate answer: %s', async (cabin, message) => {
    const { service, reads, matches } = setup();
    matches.push(0);
    reads.push(stored({ cabins: [economy({ cabin })] }));

    await expect(
      service.addCabin(FLIGHT_ID, dto({ cabin }), 'moderator-1'),
    ).rejects.toThrow(new ConflictException(message));
  });

  it('answers 404 if the flight is gone when it is read back', async () => {
    const { service } = setup();

    await expect(
      service.addCabin(FLIGHT_ID, dto(), 'moderator-1'),
    ).rejects.toThrow(new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE));
  });
});

describe('FlightCabinsService.updateCabin (FLT-04, FLT-05)', () => {
  const cabinId = CABIN_ID.toString();

  it('refuses an empty body with 400 before it reads anything', async () => {
    const { service, flights, airlines } = setup();

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, {}, 'moderator-1'),
    ).rejects.toThrow(new BadRequestException(EMPTY_CABIN_UPDATE_MESSAGE));
    expect(airlines.findAssignedAirlineOrThrow).not.toHaveBeenCalled();
    expect(flights.findById).not.toHaveBeenCalled();
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('sets only the fields sent, on the cabin whose counters were read (compare-and-set)', async () => {
    const { service, flights, reads } = setup();
    reads.push(
      stored(),
      stored({ cabins: [economy({ price: 30000, freeBags: 2 })] }),
    );

    const result = await service.updateCabin(
      FLIGHT_ID,
      cabinId,
      { price: 30000, freeBags: 2 },
      'moderator-1',
    );

    expect(flights.updateOne).toHaveBeenCalledTimes(1);
    expect(flights.updateOne).toHaveBeenCalledWith(
      {
        _id: FLIGHT_ID,
        airlineId: AIRLINE_ID,
        // scheduledFlightFilter(now) (FLT-30), in the write itself.
        status: FlightStatus.Scheduled,
        departureAt: { $gt: NOW },
        cabins: {
          $elemMatch: { _id: CABIN_ID, bookedSeats: 10, heldSeats: 5 },
        },
      },
      { $set: { 'cabins.$.price': 30000, 'cabins.$.freeBags': 2 } },
      { runValidators: true },
    );
    expect(result.cabins[0]).toMatchObject({ price: 30000, freeBags: 2 });
  });

  it('sets every editable field, and never the class or the counters', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored(), stored());

    await service.updateCabin(
      FLIGHT_ID,
      cabinId,
      { totalSeats: 200, price: 1, freeBags: 0, maxBagKg: 1 },
      'moderator-1',
    );

    expect(
      (flights.updateOne.mock.calls[0] as unknown as [unknown, unknown])[1],
    ).toEqual({
      $set: {
        'cabins.$.totalSeats': 200,
        'cabins.$.price': 1,
        'cabins.$.freeBags': 0,
        'cabins.$.maxBagKg': 1,
      },
    });
  });

  it('counts a write that matched but changed no value as a success', async () => {
    const { service, flights, reads, matches, modified } = setup();
    matches.push(1);
    modified.push(0);
    reads.push(stored(), stored());

    const result = await service.updateCabin(
      FLIGHT_ID,
      cabinId,
      { price: 25000 },
      'moderator-1',
    );

    expect(result.cabins[0].price).toBe(25000);
    // No retry: matchedCount decides, modifiedCount is not read.
    expect(flights.updateOne).toHaveBeenCalledTimes(1);
  });

  it('refuses a seat count below the seats booked and held with 400 on totalSeats', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored());

    const error = await failureOf(
      service.updateCabin(
        FLIGHT_ID,
        cabinId,
        { totalSeats: 14 },
        'moderator-1',
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: 'Validation failed',
      errors: [
        {
          field: 'totalSeats',
          messages: [
            'totalSeats cannot be below the 15 seats already booked or held',
          ],
        },
      ] satisfies FieldError[],
    });
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('accepts a seat count equal to the seats booked and held', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored(), stored());

    await service.updateCabin(
      FLIGHT_ID,
      cabinId,
      { totalSeats: 15 },
      'moderator-1',
    );

    expect(flights.updateOne).toHaveBeenCalledTimes(1);
  });

  it('does not apply the seat floor when the seat count is not sent', async () => {
    const { service, flights, reads } = setup();
    reads.push(
      stored({ cabins: [economy({ totalSeats: 15, bookedSeats: 15 })] }),
      stored(),
    );

    await service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1');

    expect(flights.updateOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'the flight does not exist',
      null,
      NotFoundException,
      FLIGHT_NOT_FOUND_MESSAGE,
    ],
    [
      'the flight belongs to another airline',
      stored({ airlineId: OTHER_AIRLINE_ID }),
      ForbiddenException,
      FOREIGN_FLIGHT_MESSAGE,
    ],
    [
      'the flight is cancelled',
      stored({ status: FlightStatus.Cancelled }),
      ConflictException,
      FLIGHT_NOT_SCHEDULED_MESSAGE,
    ],
    [
      'the flight is departed',
      stored({ status: FlightStatus.Departed }),
      ConflictException,
      FLIGHT_NOT_SCHEDULED_MESSAGE,
    ],
    [
      'the departure time has passed, the stored status is still scheduled (FLT-30)',
      stored({ departureAt: PAST }),
      ConflictException,
      FLIGHT_NOT_SCHEDULED_MESSAGE,
    ],
    [
      'the flight has no such cabin',
      stored({ cabins: [economy({ _id: new Types.ObjectId() })] }),
      NotFoundException,
      CABIN_NOT_FOUND_MESSAGE,
    ],
    [
      'a flight stored with no cabins field',
      stored({ cabins: undefined }),
      NotFoundException,
      CABIN_NOT_FOUND_MESSAGE,
    ],
  ])(
    'refuses when %s, and writes nothing',
    async (_case, flight, type, message) => {
      const { service, flights, reads } = setup();
      reads.push(flight);

      const error = await failureOf(
        service.updateCabin(
          FLIGHT_ID,
          cabinId,
          { totalSeats: 1 },
          'moderator-1',
        ),
      );

      expect(error).toBeInstanceOf(type);
      expect(error.message).toBe(message);
      expect(flights.updateOne).not.toHaveBeenCalled();
    },
  );

  it('checks the flight before the cabin, and the cabin before the seat floor', async () => {
    const foreign = setup();
    foreign.reads.push(
      stored({ airlineId: OTHER_AIRLINE_ID, status: FlightStatus.Cancelled }),
    );
    await expect(
      foreign.service.updateCabin(
        FLIGHT_ID,
        UNKNOWN_CABIN_ID,
        { totalSeats: 1 },
        'm',
      ),
    ).rejects.toThrow(ForbiddenException);

    const cancelled = setup();
    cancelled.reads.push(stored({ status: FlightStatus.Cancelled }));
    await expect(
      cancelled.service.updateCabin(
        FLIGHT_ID,
        UNKNOWN_CABIN_ID,
        { totalSeats: 1 },
        'm',
      ),
    ).rejects.toThrow(new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE));

    const unknownCabin = setup();
    unknownCabin.reads.push(stored());
    await expect(
      unknownCabin.service.updateCabin(
        FLIGHT_ID,
        UNKNOWN_CABIN_ID,
        { totalSeats: 1 },
        'm',
      ),
    ).rejects.toThrow(new NotFoundException(CABIN_NOT_FOUND_MESSAGE));
  });

  it('reads again and retries with the new counters when a booking moved them in between', async () => {
    const { service, flights, reads, matches } = setup();
    matches.push(0, 1);
    reads.push(
      stored(),
      stored({ cabins: [economy({ bookedSeats: 12, heldSeats: 1 })] }),
      stored(),
    );

    await service.updateCabin(
      FLIGHT_ID,
      cabinId,
      { totalSeats: 100 },
      'moderator-1',
    );

    expect(flights.updateOne).toHaveBeenCalledTimes(2);
    const filters = (
      flights.updateOne.mock.calls as unknown as [
        { cabins: { $elemMatch: Record<string, unknown> } },
      ][]
    ).map(([filter]) => filter.cabins.$elemMatch);
    expect(filters).toEqual([
      { _id: CABIN_ID, bookedSeats: 10, heldSeats: 5 },
      { _id: CABIN_ID, bookedSeats: 12, heldSeats: 1 },
    ]);
  });

  it('checks the seat floor again against the counters read on a retry', async () => {
    const { service, flights, reads, matches } = setup();
    matches.push(0);
    reads.push(
      stored(),
      stored({ cabins: [economy({ bookedSeats: 20, heldSeats: 0 })] }),
    );

    const error = await failureOf(
      service.updateCabin(
        FLIGHT_ID,
        cabinId,
        { totalSeats: 16 },
        'moderator-1',
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(flights.updateOne).toHaveBeenCalledTimes(1);
  });

  it('answers 409 not scheduled when the flight was cancelled between two tries', async () => {
    const { service, reads, matches } = setup();
    matches.push(0);
    reads.push(stored(), stored({ status: FlightStatus.Cancelled }));

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1'),
    ).rejects.toThrow(new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE));
  });

  it('reads only the fields the checks need, by the flight id', async () => {
    const { service, flights, reads, selects } = setup();
    reads.push(stored(), stored());

    await service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1');

    expect(flights.findById).toHaveBeenNthCalledWith(1, FLIGHT_ID);
    expect(selects).toEqual(['airlineId status departureAt cabins']);
  });

  it('answers 404 if the flight is gone when it is read back after the write', async () => {
    const { service, reads } = setup();
    reads.push(stored());

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1'),
    ).rejects.toThrow(new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE));
  });

  it('answers 404 when the airline of the moderator no longer exists, and writes nothing', async () => {
    const { service, flights, airlines } = setup();
    airlines.findAssignedAirlineOrThrow.mockRejectedValue(
      new NotFoundException('Airline not found'),
    );

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1'),
    ).rejects.toThrow(new NotFoundException('Airline not found'));
    expect(flights.findById).not.toHaveBeenCalled();
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it(`gives up with 409 after ${CABIN_UPDATE_ATTEMPTS} tries that all matched nothing`, async () => {
    const { service, flights, reads, matches } = setup();
    matches.push(0, 0, 0);
    reads.push(stored(), stored(), stored());

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1'),
    ).rejects.toThrow(new ConflictException(CABIN_CHANGED_MESSAGE));
    expect(flights.updateOne).toHaveBeenCalledTimes(CABIN_UPDATE_ATTEMPTS);
    expect(flights.findById).toHaveBeenCalledTimes(CABIN_UPDATE_ATTEMPTS);
  });

  it('writes nothing when the moderator has no airline', async () => {
    const { service, flights, airlines } = setup();
    airlines.findAssignedAirlineOrThrow.mockRejectedValue(
      new ForbiddenException('You are not assigned to an airline'),
    );

    await expect(
      service.updateCabin(FLIGHT_ID, cabinId, { price: 1 }, 'moderator-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(flights.findById).not.toHaveBeenCalled();
    expect(flights.updateOne).not.toHaveBeenCalled();
  });
});
