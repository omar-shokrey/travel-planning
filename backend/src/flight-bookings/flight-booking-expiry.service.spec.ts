import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import type { FlightSeatsService } from './flight-seats.service';

/** A fixed "now" for every run. */
const NOW = new Date('2026-11-19T10:00:00.000Z');

const dueBooking = (cabin = CabinClass.Economy, seats = 2) => ({
  _id: new Types.ObjectId(),
  segments: [
    {
      flightId: new Types.ObjectId(),
      airlineId: new Types.ObjectId(),
      cabin,
      fare: 25000,
      seatsReserved: seats,
    },
  ],
});

function setup() {
  /** What each `find(...).exec()` resolves to, in order. */
  const finds: unknown[][] = [];
  /** What each `updateOne(...).exec()` reports as `matchedCount`, in order (default 1). */
  const matches: number[] = [];
  const calls: string[] = [];
  const query = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(() => Promise.resolve(finds.shift() ?? [])),
  };
  const bookings = {
    find: jest.fn(() => query),
    updateOne: jest.fn(() => ({
      exec: jest.fn(() => {
        calls.push('expire');
        return Promise.resolve({ matchedCount: matches.shift() ?? 1 });
      }),
    })),
  };
  const seatHolds = {
    release: jest.fn(() => {
      calls.push('release');
      return Promise.resolve(true);
    }),
  };
  const seatAssignments = {
    releaseBooking: jest.fn((..._args: unknown[]) => {
      calls.push('free chosen seats');
      return Promise.resolve(0);
    }),
  };
  const service = new FlightBookingExpiryService(
    bookings as never,
    seatHolds as unknown as FlightSeatHoldsService,
    seatAssignments as unknown as FlightSeatsService,
  );
  return {
    service,
    bookings,
    query,
    seatHolds,
    seatAssignments,
    finds,
    matches,
    calls,
  };
}

let logError: jest.SpyInstance;

beforeEach(() => {
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FlightBookingExpiryService.expireDueHolds (FLT-22)', () => {
  it('reads only pending_payment bookings whose hold has ended, oldest first, at most 100', async () => {
    const { service, bookings, query } = setup();

    await expect(service.expireDueHolds(NOW)).resolves.toBe(0);

    // A booking whose hold has not ended, or that is no longer pending, is never read.
    expect(bookings.find).toHaveBeenCalledWith({
      status: FlightBookingStatus.PendingPayment,
      holdExpiresAt: { $lte: NOW },
    });
    expect(query.sort).toHaveBeenCalledWith({ holdExpiresAt: 1 });
    expect(query.limit).toHaveBeenCalledWith(100);
  });

  it('expires a due booking, then releases its seats once and frees its chosen seats (FLT-28)', async () => {
    const { service, bookings, seatHolds, seatAssignments, finds, calls } =
      setup();
    const booking = dueBooking(CabinClass.Business, 3);
    finds.push([booking]);

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);

    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: booking._id,
        status: FlightBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: NOW },
      },
      { $set: { status: FlightBookingStatus.Expired } },
    );
    expect(calls).toEqual(['expire', 'release', 'free chosen seats']);
    expect(seatHolds.release).toHaveBeenCalledTimes(1);
    expect(seatHolds.release).toHaveBeenCalledWith(
      booking.segments[0].flightId,
      CabinClass.Business,
      3,
    );
    expect(seatAssignments.releaseBooking).toHaveBeenCalledWith(booking._id);
  });

  it('never releases the seats of a booking confirmed since it was read', async () => {
    const { service, seatHolds, seatAssignments, finds, matches } = setup();
    finds.push([dueBooking()]);
    // The update matches only a booking still pending_payment.
    matches.push(0);

    await expect(service.expireDueHolds(NOW)).resolves.toBe(0);
    expect(seatHolds.release).not.toHaveBeenCalled();
    expect(seatAssignments.releaseBooking).not.toHaveBeenCalled();
  });

  it('releases once when two runs expire the same booking at the same moment', async () => {
    const { service, seatHolds, finds, matches } = setup();
    const booking = dueBooking();
    finds.push([booking], [booking]);
    // The first update wins; the second finds the booking already expired.
    matches.push(1, 0);

    const results = await Promise.all([
      service.expireDueHolds(NOW),
      service.expireDueHolds(NOW),
    ]);

    expect(results.sort()).toEqual([0, 1]);
    expect(seatHolds.release).toHaveBeenCalledTimes(1);
  });

  it('logs a failed release and still handles the next booking', async () => {
    const { service, seatHolds, finds } = setup();
    const first = dueBooking();
    const second = dueBooking(CabinClass.First, 1);
    finds.push([first, second]);
    seatHolds.release.mockImplementationOnce(() =>
      Promise.reject(new Error('release failed')),
    );

    await expect(service.expireDueHolds(NOW)).resolves.toBe(2);

    expect(seatHolds.release).toHaveBeenCalledTimes(2);
    expect(seatHolds.release).toHaveBeenLastCalledWith(
      second.segments[0].flightId,
      CabinClass.First,
      1,
    );
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain(first._id.toString());
  });

  it('logs a failure to free the chosen seats and still counts the booking as expired', async () => {
    const { service, seatAssignments, finds } = setup();
    const booking = dueBooking();
    finds.push([booking]);
    seatAssignments.releaseBooking.mockImplementationOnce(() =>
      Promise.reject(new Error('free failed')),
    );

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain(
      `${booking._id.toString()} expired but its chosen seats were not freed`,
    );
    expect(logError.mock.calls[0][1]).toEqual(
      expect.stringContaining('free failed'),
    );
  });

  it('logs a non-Error failure to free the chosen seats as it is', async () => {
    const { service, seatAssignments, finds } = setup();
    finds.push([dueBooking()]);
    seatAssignments.releaseBooking.mockImplementationOnce(() =>
      Promise.reject('down'),
    );

    await service.expireDueHolds(NOW);

    expect(logError.mock.calls[0][1]).toBe('down');
  });

  it('logs a failed status update, releases nothing for it, and goes on', async () => {
    const { service, bookings, seatHolds, finds } = setup();
    finds.push([dueBooking(), dueBooking()]);
    bookings.updateOne.mockImplementationOnce(() => ({
      exec: jest.fn(() => Promise.reject(new Error('write failed'))),
    }));

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);
    expect(seatHolds.release).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('FlightBookingExpiryService.expireDueHoldsJob (FLT-22)', () => {
  it('runs every minute', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        FlightBookingExpiryService.prototype.expireDueHoldsJob,
      ),
    ).toMatchObject({ cronTime: CronExpression.EVERY_MINUTE });
  });

  it('runs with the current time', async () => {
    jest.useFakeTimers({ now: NOW });
    const { service, bookings } = setup();

    await service.expireDueHoldsJob();

    expect(bookings.find).toHaveBeenCalledWith(
      expect.objectContaining({ holdExpiresAt: { $lte: NOW } }),
    );
    jest.useRealTimers();
  });

  it('catches and logs every error, so the job never crashes the app', async () => {
    const { service, query } = setup();
    query.exec.mockImplementationOnce(() =>
      Promise.reject(new Error('database down')),
    );

    await expect(service.expireDueHoldsJob()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
