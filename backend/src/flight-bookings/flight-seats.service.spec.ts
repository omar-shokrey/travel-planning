import { ConflictException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { SEAT_TAKEN_MESSAGE } from './flight-bookings.constants';
import { FlightSeatsService } from './flight-seats.service';

const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const OTHER_BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
const FLIGHT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const USER = new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb');

const key = { bookingId: BOOKING, segmentIndex: 0, passengerIndex: 1 };
const claim = {
  ...key,
  flightId: FLIGHT,
  cabin: CabinClass.Economy,
  userId: USER,
  seatNumber: '12C',
};

const duplicate = (keyPattern: Record<string, number>) =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern });

/** A Mongoose query that resolves to `value` (or rejects with it). */
const query = (value: unknown, fails = false) => {
  const chain = {
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn(() =>
      fails ? Promise.reject(value) : Promise.resolve(value),
    ),
  };
  chain.sort.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

function setup() {
  const model = {
    find: jest.fn((..._args: unknown[]) => query([])),
    findOneAndUpdate: jest.fn((..._args: unknown[]) => query(null)),
    updateOne: jest.fn((..._args: unknown[]) => query({ matchedCount: 1 })),
    deleteOne: jest.fn((..._args: unknown[]) => query({ deletedCount: 1 })),
    deleteMany: jest.fn((..._args: unknown[]) => query({ deletedCount: 3 })),
  };
  const service = new FlightSeatsService(model as never);
  return { service, model };
}

describe('FlightSeatsService reads (FLT-28)', () => {
  it("reads one booking's seats by its id, by segment then passenger", async () => {
    const { service, model } = setup();
    const found = [{ seatNumber: '1A' }];
    const chain = query(found);
    model.find.mockReturnValueOnce(chain);

    await expect(service.findByBooking(BOOKING.toString())).resolves.toBe(
      found,
    );

    expect(model.find).toHaveBeenCalledWith({ bookingId: BOOKING });
    expect(chain.sort).toHaveBeenCalledWith({
      segmentIndex: 1,
      passengerIndex: 1,
    });
  });

  it('reads the seats of several bookings in one query and groups them by booking', async () => {
    const { service, model } = setup();
    const first = { bookingId: BOOKING, seatNumber: '1A' };
    const second = { bookingId: BOOKING, seatNumber: '1B' };
    const third = { bookingId: OTHER_BOOKING, seatNumber: '2A' };
    model.find.mockReturnValueOnce(query([first, second, third]));

    const byBooking = await service.findByBookings([BOOKING, OTHER_BOOKING]);

    expect(model.find).toHaveBeenCalledTimes(1);
    expect(model.find).toHaveBeenCalledWith({
      bookingId: { $in: [BOOKING, OTHER_BOOKING] },
    });
    expect(byBooking.get(BOOKING.toString())).toEqual([first, second]);
    expect(byBooking.get(OTHER_BOOKING.toString())).toEqual([third]);
  });

  it('reads nothing for no booking', async () => {
    const { service, model } = setup();

    await expect(service.findByBookings([])).resolves.toEqual(new Map());
    expect(model.find).not.toHaveBeenCalled();
  });

  it('reads every taken seat of one cabin of one flight', async () => {
    const { service, model } = setup();

    await service.takenOn(FLIGHT, CabinClass.Business);

    expect(model.find).toHaveBeenCalledWith({
      flightId: FLIGHT,
      cabin: CabinClass.Business,
    });
  });
});

describe('FlightSeatsService.claim (FLT-28)', () => {
  it('gives the seat with one upsert keyed by the passenger, and answers null for a first choice', async () => {
    const { service, model } = setup();

    await expect(service.claim(claim)).resolves.toBeNull();

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      key,
      {
        $set: {
          flightId: FLIGHT,
          cabin: CabinClass.Economy,
          userId: USER,
          seatNumber: '12C',
        },
      },
      { upsert: true, returnDocument: 'before', runValidators: true },
    );
  });

  it('answers the seat the passenger had before a change', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockReturnValueOnce(query({ seatNumber: '9A' }));

    await expect(service.claim(claim)).resolves.toBe('9A');
  });

  it('answers 409 "Seat already taken" when the seat index refuses the write, without trying again', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockReturnValueOnce(
      query(duplicate({ flightId: 1, cabin: 1, seatNumber: 1 }), true),
    );

    const error = await service.claim(claim).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SEAT_TAKEN_MESSAGE);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('tries once more after a race on the same passenger, which then updates the other document', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate
      .mockReturnValueOnce(
        query(
          duplicate({ bookingId: 1, segmentIndex: 1, passengerIndex: 1 }),
          true,
        ),
      )
      .mockReturnValueOnce(query({ seatNumber: '14D' }));

    await expect(service.claim(claim)).resolves.toBe('14D');
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second race on the same passenger', async () => {
    const { service, model } = setup();
    const race = duplicate({
      bookingId: 1,
      segmentIndex: 1,
      passengerIndex: 1,
    });
    model.findOneAndUpdate
      .mockReturnValueOnce(query(race, true))
      .mockReturnValueOnce(query(race, true));

    await expect(service.claim(claim)).rejects.toBe(race);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('reads the seat index from the message when the error has no key pattern', async () => {
    const { service, model } = setup();
    const bare = Object.assign(
      new Error(
        'E11000 duplicate key error index: flightId_1_cabin_1_seatNumber_1',
      ),
      { code: 11000 },
    );
    model.findOneAndUpdate.mockReturnValueOnce(query(bare, true));

    const error = await service.claim(claim).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SEAT_TAKEN_MESSAGE);
  });

  it('treats a duplicate key error with no pattern and no seat in its message as a passenger race, and passes on any other error', async () => {
    const { service, model } = setup();
    const bare = Object.assign(new Error('E11000'), { code: 11000 });
    const other = new Error('network');
    model.findOneAndUpdate
      .mockReturnValueOnce(query(bare, true))
      .mockReturnValueOnce(query(bare, true))
      .mockReturnValueOnce(query(other, true));

    await expect(service.claim(claim)).rejects.toBe(bare);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
    await expect(service.claim(claim)).rejects.toBe(other);
  });
});

describe('FlightSeatsService.restore (FLT-28)', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('gives the passenger back their previous seat, only if they still hold the new one', async () => {
    const { service, model } = setup();

    await service.restore(key, '12C', '9A');

    expect(model.updateOne).toHaveBeenCalledWith(
      { ...key, seatNumber: '12C' },
      { $set: { seatNumber: '9A' } },
    );
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('takes the seat away again when the passenger had none before', async () => {
    const { service, model } = setup();

    await service.restore(key, '12C', null);

    expect(model.deleteOne).toHaveBeenCalledWith({ ...key, seatNumber: '12C' });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('never throws: when the old seat was taken in between, the passenger keeps the new one and it is logged', async () => {
    const { service, model } = setup();
    model.updateOne.mockReturnValueOnce(
      query(duplicate({ flightId: 1, cabin: 1, seatNumber: 1 }), true),
    );

    await expect(service.restore(key, '12C', '9A')).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain('they keep 12C');
  });

  it('logs a non-Error failure as it is, and names "(none)" for no previous seat', async () => {
    const { service, model } = setup();
    model.deleteOne.mockReturnValueOnce(query('down', true));

    await service.restore(key, '12C', null);

    expect(logError.mock.calls[0][0]).toContain('back seat (none)');
    expect(logError.mock.calls[0][1]).toBe('down');
  });
});

describe('FlightSeatsService.releaseBooking (FLT-28)', () => {
  it("frees every seat of the booking with a filter on the booking's id only", async () => {
    const { service, model } = setup();

    await expect(service.releaseBooking(BOOKING.toString())).resolves.toBe(3);

    expect(model.deleteMany).toHaveBeenCalledWith({ bookingId: BOOKING });
  });
});
