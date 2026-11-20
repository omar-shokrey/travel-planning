import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingCompletionService } from './hotel-booking-completion.service';
import { canHotelBookingMoveTo } from './hotel-booking-lifecycle';

const NOW = new Date('2027-03-01T00:30:00.000Z');

function setup(modifiedCount = 0) {
  const exec = jest.fn().mockResolvedValue({ modifiedCount });
  const bookings = {
    updateMany: jest.fn((..._args: unknown[]) => ({ exec })),
  };
  const service = new HotelBookingCompletionService(bookings as never);
  return { service, bookings, exec };
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

describe('HotelBookingCompletionService.completeCheckedOut (GEN-11)', () => {
  it('completes only confirmed reservations whose check-out date is before today (UTC)', async () => {
    const { service, bookings } = setup(3);

    await expect(service.completeCheckedOut(NOW)).resolves.toBe(3);

    // 00:30 UTC on 1 March: a check-out on 28 February is done, one today is not.
    expect(bookings.updateMany).toHaveBeenCalledWith(
      { status: HotelBookingStatus.Confirmed, checkOut: { $lt: '2027-03-01' } },
      { $set: { status: HotelBookingStatus.Completed } },
    );
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.Confirmed,
        HotelBookingStatus.Completed,
      ),
    ).toBe(true);
  });

  it('uses the UTC date even late in the day, across a year end', async () => {
    const { service, bookings } = setup();

    await service.completeCheckedOut(new Date('2027-12-31T23:59:59.000Z'));

    expect(bookings.updateMany.mock.calls[0][0]).toEqual({
      status: HotelBookingStatus.Confirmed,
      checkOut: { $lt: '2027-12-31' },
    });
  });
});

describe('HotelBookingCompletionService.completeJob (GEN-11)', () => {
  it('runs every hour', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        HotelBookingCompletionService.prototype.completeJob,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_HOUR,
      name: 'hotel-booking-completion',
    });
  });

  it('runs at the current time and logs how many it completed', async () => {
    jest.useFakeTimers({ now: NOW });
    const { service, bookings } = setup(2);

    await service.completeJob();

    expect(bookings.updateMany.mock.calls[0][0]).toMatchObject({
      checkOut: { $lt: '2027-03-01' },
    });
    expect(logInfo).toHaveBeenCalledWith('Completed 2 hotel reservation(s)');
  });

  it('logs nothing when nothing was completed', async () => {
    const { service } = setup(0);

    await service.completeJob();

    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([new Error('database down'), 'database down'])(
    'catches and logs every error (%p), so the job never crashes the app',
    async (failure) => {
      const { service, exec } = setup();
      exec.mockRejectedValueOnce(failure);

      await expect(service.completeJob()).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0][1])).toContain('database down');
    },
  );
});
