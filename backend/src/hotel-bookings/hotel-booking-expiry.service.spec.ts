import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';

/** A fixed "now" for every run. */
const NOW = new Date('2026-11-19T10:00:00.000Z');

const dueBooking = () => ({ _id: new Types.ObjectId() });

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
  const roomHolds = {
    release: jest.fn((_bookingId: Types.ObjectId) => {
      calls.push('release');
      return Promise.resolve();
    }),
  };
  const service = new HotelBookingExpiryService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
  );
  return { service, bookings, query, roomHolds, finds, matches, calls };
}

let logError: jest.SpyInstance;
let logInfo: jest.SpyInstance;

beforeEach(() => {
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  logInfo = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('HotelBookingExpiryService.expireDueHolds (HTL-18)', () => {
  it('reads only pending_payment reservations whose hold has ended, oldest first, at most 100', async () => {
    const { service, bookings, query, roomHolds } = setup();

    await expect(service.expireDueHolds(NOW)).resolves.toBe(0);

    // A reservation whose hold has not ended, or that is no longer pending, is never read.
    expect(bookings.find).toHaveBeenCalledWith({
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: { $lte: NOW },
    });
    expect(query.sort).toHaveBeenCalledWith({ holdExpiresAt: 1 });
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.select).toHaveBeenCalledWith('_id');
    expect(bookings.updateOne).not.toHaveBeenCalled();
    expect(roomHolds.release).not.toHaveBeenCalled();
  });

  it('expires a due reservation, then releases its nights once', async () => {
    const { service, bookings, roomHolds, finds, calls } = setup();
    const booking = dueBooking();
    finds.push([booking]);

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);

    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: booking._id,
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: NOW },
      },
      { $set: { status: HotelBookingStatus.Expired } },
    );
    expect(calls).toEqual(['expire', 'release']);
    expect(roomHolds.release).toHaveBeenCalledTimes(1);
    expect(roomHolds.release).toHaveBeenCalledWith(booking._id);
  });

  it('expires every due reservation of the batch', async () => {
    const { service, roomHolds, finds, calls } = setup();
    const [first, second, third] = [dueBooking(), dueBooking(), dueBooking()];
    finds.push([first, second, third]);

    await expect(service.expireDueHolds(NOW)).resolves.toBe(3);

    expect(calls).toEqual([
      'expire',
      'release',
      'expire',
      'release',
      'expire',
      'release',
    ]);
    expect(roomHolds.release.mock.calls.map(([id]) => id)).toEqual([
      first._id,
      second._id,
      third._id,
    ]);
  });

  it('never releases the nights of a reservation confirmed since it was read', async () => {
    const { service, roomHolds, finds, matches } = setup();
    finds.push([dueBooking()]);
    // The update matches only a reservation still pending_payment.
    matches.push(0);

    await expect(service.expireDueHolds(NOW)).resolves.toBe(0);
    expect(roomHolds.release).not.toHaveBeenCalled();
  });

  it('releases once when two runs expire the same reservation at the same moment', async () => {
    const { service, roomHolds, finds, matches } = setup();
    const booking = dueBooking();
    finds.push([booking], [booking]);
    // The first update wins; the second finds the reservation already expired.
    matches.push(1, 0);

    const results = await Promise.all([
      service.expireDueHolds(NOW),
      service.expireDueHolds(NOW),
    ]);

    expect(results.sort()).toEqual([0, 1]);
    expect(roomHolds.release).toHaveBeenCalledTimes(1);
  });

  it('logs a failed release and still handles the next reservation', async () => {
    const { service, roomHolds, finds } = setup();
    const first = dueBooking();
    const second = dueBooking();
    finds.push([first, second]);
    roomHolds.release.mockImplementationOnce(() =>
      Promise.reject(new Error('release failed')),
    );

    await expect(service.expireDueHolds(NOW)).resolves.toBe(2);

    expect(roomHolds.release).toHaveBeenCalledTimes(2);
    expect(roomHolds.release).toHaveBeenLastCalledWith(second._id);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain(first._id.toString());
    expect(logError.mock.calls[0][1]).toContain('release failed');
  });

  it('logs a failed status update, releases nothing for it, and goes on', async () => {
    const { service, bookings, roomHolds, finds } = setup();
    const first = dueBooking();
    const second = dueBooking();
    finds.push([first, second]);
    bookings.updateOne.mockImplementationOnce(() => ({
      exec: jest.fn(() => Promise.reject(new Error('write failed'))),
    }));

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);
    expect(roomHolds.release).toHaveBeenCalledTimes(1);
    expect(roomHolds.release).toHaveBeenCalledWith(second._id);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain(first._id.toString());
  });

  it('logs a thrown value that is not an Error as it is', async () => {
    const { service, bookings, roomHolds, finds } = setup();
    finds.push([dueBooking(), dueBooking()]);
    bookings.updateOne.mockImplementationOnce(() => ({
      exec: jest.fn(() => Promise.reject('write failed')),
    }));
    roomHolds.release.mockImplementationOnce(() =>
      Promise.reject('release failed'),
    );

    await expect(service.expireDueHolds(NOW)).resolves.toBe(1);
    expect(logError.mock.calls.map(([, detail]) => detail as string)).toEqual([
      'write failed',
      'release failed',
    ]);
  });
});

describe('HotelBookingExpiryService.expireDueHoldsJob (HTL-18)', () => {
  it('runs every minute', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        HotelBookingExpiryService.prototype.expireDueHoldsJob,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_MINUTE,
      name: 'hotel-booking-hold-expiry',
    });
  });

  it('runs with the current time and logs how many it expired', async () => {
    jest.useFakeTimers({ now: NOW });
    const { service, bookings, finds } = setup();
    finds.push([dueBooking(), dueBooking()]);

    await service.expireDueHoldsJob();

    expect(bookings.find).toHaveBeenCalledWith(
      expect.objectContaining({ holdExpiresAt: { $lte: NOW } }),
    );
    expect(logInfo).toHaveBeenCalledWith(
      'Expired 2 unpaid hotel reservation hold(s)',
    );
  });

  it('logs nothing when nothing was due', async () => {
    const { service } = setup();

    await service.expireDueHoldsJob();

    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('catches and logs every error, so the job never crashes the app', async () => {
    const { service, query } = setup();
    query.exec.mockImplementationOnce(() =>
      Promise.reject(new Error('database down')),
    );

    await expect(service.expireDueHoldsJob()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][1]).toContain('database down');
  });

  it('logs a thrown value that is not an Error as it is', async () => {
    const { service, query } = setup();
    query.exec.mockImplementationOnce(() => Promise.reject('database down'));

    await expect(service.expireDueHoldsJob()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      'The hotel reservation hold-expiry job failed',
      'database down',
    );
  });
});
