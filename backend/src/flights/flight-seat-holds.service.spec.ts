import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  cabinHasSeatsLeft,
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  FlightSeatHoldsService,
  NOT_ENOUGH_SEATS_MESSAGE,
} from './flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from './flights.constants';
import { CabinClass } from './models/cabin-class.enum';
import { FlightStatus } from './models/flight-status.enum';

const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

/** "Now" for every test (FLT-30); the stored flight departs months later. */
const NOW = new Date('2027-01-10T00:00:00.000Z');

const economy = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
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
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  status: FlightStatus.Scheduled,
  cabins: [economy()],
  ...fields,
});

function setup() {
  /** What each `findById(...).exec()` resolves to, in order. */
  const reads: unknown[] = [];
  /** What each `findOneAndUpdate(...).exec()` resolves to, in order. */
  const updates: unknown[] = [];
  /** What each `airlines.exists(...).exec()` resolves to, in order (default: active). */
  const airlineReads: unknown[] = [];
  /** What each `updateOne(...).exec()` reports as `matchedCount`, in order (default 1). */
  const matches: number[] = [];

  const flights = {
    findById: jest.fn(() => {
      interface Query {
        select: jest.Mock<Query, [unknown]>;
        lean: jest.Mock<Query, []>;
        exec: jest.Mock<Promise<unknown>, []>;
      }
      const query: Query = {
        select: jest.fn((_fields: unknown) => query),
        lean: jest.fn(() => query),
        exec: jest.fn(() => Promise.resolve(reads.shift() ?? null)),
      };
      return query;
    }),
    findOneAndUpdate: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(() => Promise.resolve(updates.shift() ?? null)),
    })),
    updateOne: jest.fn(() => ({
      exec: jest.fn(() =>
        Promise.resolve({ matchedCount: matches.shift() ?? 1 }),
      ),
    })),
  };
  const airlines = {
    exists: jest.fn(() => ({
      exec: jest.fn(() =>
        Promise.resolve(
          airlineReads.length > 0 ? airlineReads.shift() : { _id: AIRLINE_ID },
        ),
      ),
    })),
  };
  const service = new FlightSeatHoldsService(
    flights as never,
    airlines as never,
  );
  return { service, flights, airlines, reads, updates, airlineReads, matches };
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

describe('cabinHasSeatsLeft (FLT-22)', () => {
  it('compares the one cabin of the class: totalSeats - bookedSeats - heldSeats >= seats', () => {
    expect(cabinHasSeatsLeft(CabinClass.Business, 3)).toEqual({
      $gte: [
        {
          $let: {
            vars: {
              c: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$cabins',
                      cond: { $eq: ['$$this.cabin', 'business'] },
                    },
                  },
                  0,
                ],
              },
            },
            in: {
              $subtract: [
                '$$c.totalSeats',
                { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
              ],
            },
          },
        },
        3,
      ],
    });
  });
});

describe('FlightSeatHoldsService.hold (FLT-22)', () => {
  it('holds the seats with one conditional update: scheduled, cabin present, enough seats left', async () => {
    const { service, flights, reads, updates } = setup();
    reads.push(stored());
    const after = stored({ cabins: [economy({ heldSeats: 7 })] });
    updates.push(after);

    await expect(
      service.hold(FLIGHT_ID, CabinClass.Economy, 2, NOW),
    ).resolves.toBe(after);

    expect(flights.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(flights.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: FLIGHT_ID,
        status: FlightStatus.Scheduled,
        departureAt: { $gt: NOW },
        cabins: { $elemMatch: { cabin: CabinClass.Economy } },
        $expr: cabinHasSeatsLeft(CabinClass.Economy, 2),
      },
      { $inc: { 'cabins.$[c].heldSeats': 2 } },
      { arrayFilters: [{ 'c.cabin': 'economy' }], returnDocument: 'after' },
    );
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing flight and holds nothing', async () => {
    const { service, flights, airlines } = setup();

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.Economy, 1, NOW),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    expect(airlines.exists).not.toHaveBeenCalled();
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for a flight of a deactivated airline (ACC-15) and holds nothing', async () => {
    const { service, flights, airlines, reads, airlineReads } = setup();
    reads.push(stored());
    airlineReads.push(null);

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.Economy, 1, NOW),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    // An airline without the field counts as active.
    expect(airlines.exists).toHaveBeenCalledWith({
      _id: AIRLINE_ID,
      active: { $ne: false },
    });
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', { status: FlightStatus.Cancelled }],
    ['stored as departed', { status: FlightStatus.Departed }],
    [
      'scheduled but its departure time has passed',
      { departureAt: new Date('2027-01-09T23:59:59.999Z') },
    ],
    ['departing exactly now', { departureAt: NOW }],
  ])(
    'answers 409 for a flight %s and holds nothing',
    async (_label, fields) => {
      const { service, flights, reads } = setup();
      reads.push(stored(fields));

      const error = await failureOf(
        service.hold(FLIGHT_ID, CabinClass.Economy, 1, NOW),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(FLIGHT_NOT_BOOKABLE_MESSAGE);
      expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a cabin the flight does not have, naming it, and holds nothing', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored());

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.PremiumEconomy, 1, NOW),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('This flight has no premium_economy cabin');
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 409 "not enough seats" when the update matched nothing and the flight is still scheduled', async () => {
    const { service, flights, reads } = setup();
    reads.push(stored(), stored());

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.Economy, 9, NOW),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(NOT_ENOUGH_SEATS_MESSAGE);
    expect(flights.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(flights.findById).toHaveBeenCalledTimes(2);
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('answers 409 "can no longer be booked" when the flight was cancelled between the read and the update', async () => {
    const { service, reads } = setup();
    reads.push(stored(), stored({ status: FlightStatus.Cancelled }));

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.Economy, 1, NOW),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(FLIGHT_NOT_BOOKABLE_MESSAGE);
  });

  it('answers 404 when the flight was deleted between the read and the update', async () => {
    const { service, reads } = setup();
    reads.push(stored());

    const error = await failureOf(
      service.hold(FLIGHT_ID, CabinClass.Economy, 1, NOW),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
  });

  it.each([0, -1, 1.5])(
    'refuses %p seats before reading anything (a programming error)',
    async (seats) => {
      const { service, flights } = setup();

      await expect(
        service.hold(FLIGHT_ID, CabinClass.Economy, seats, NOW),
      ).rejects.toBeInstanceOf(RangeError);
      expect(flights.findById).not.toHaveBeenCalled();
    },
  );
});

describe('FlightSeatHoldsService.release (FLT-22)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('takes the seats off that cabin only if it holds at least that many', async () => {
    const { service, flights } = setup();

    await expect(
      service.release(FLIGHT_ID, CabinClass.Business, 3),
    ).resolves.toBe(true);

    expect(flights.updateOne).toHaveBeenCalledWith(
      {
        _id: FLIGHT_ID,
        cabins: {
          $elemMatch: { cabin: CabinClass.Business, heldSeats: { $gte: 3 } },
        },
      },
      { $inc: { 'cabins.$[c].heldSeats': -3 } },
      { arrayFilters: [{ 'c.cabin': 'business' }] },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a mismatch instead of throwing, so the counter never goes below 0', async () => {
    const { service, matches } = setup();
    matches.push(0);

    await expect(
      service.release(FLIGHT_ID, CabinClass.Economy, 2),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Recompute heldSeats');
  });
});
