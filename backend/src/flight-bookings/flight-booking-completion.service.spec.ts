import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightBookingCompletionService } from './flight-booking-completion.service';
import { canFlightBookingMoveTo } from './flight-booking-lifecycle';

const NOW = new Date('2027-03-01T12:00:00.000Z');

type Stage = Record<string, Record<string, unknown>>;

function setup(
  due: { _id: Types.ObjectId }[] = [],
  modifiedCount = due.length,
) {
  const aggregateExec = jest.fn().mockResolvedValue(due);
  const updateExec = jest.fn().mockResolvedValue({ modifiedCount });
  const bookings = {
    aggregate: jest.fn(() => ({ exec: aggregateExec })),
    updateMany: jest.fn(() => ({ exec: updateExec })),
  };
  const flights = { collection: { collectionName: 'flights' } };
  const service = new FlightBookingCompletionService(
    bookings as never,
    flights as never,
  );
  return { service, bookings, aggregateExec, updateExec };
}

const stagesOf = (bookings: ReturnType<typeof setup>['bookings']) =>
  (bookings.aggregate.mock.calls[0] as unknown as [Stage[]])[0];

/** Runs the pipeline's $match/$addFields rules on one booking, as MongoDB would. */
function isDue(
  stages: Stage[],
  booking: {
    status: string;
    segments: number;
    flights: { arrivalAt: Date; status: string }[];
  },
): boolean {
  const [first, , rules, , last] = stages;
  if (first.$match.status !== booking.status) return false;
  expect(rules.$match).toEqual({
    $expr: { $eq: [{ $size: '$flights' }, { $size: '$segments' }] },
    'flights.status': { $ne: FlightStatus.Cancelled },
  });
  if (booking.flights.length !== booking.segments) return false;
  if (
    booking.flights.some((flight) => flight.status === FlightStatus.Cancelled)
  )
    return false;
  const lastArrival = Math.max(
    ...booking.flights.map((f) => f.arrivalAt.getTime()),
  );
  const bound = (last.$match.lastArrival as { $lte: Date }).$lte;
  return lastArrival <= bound.getTime();
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

describe('FlightBookingCompletionService.completeArrived (GEN-11)', () => {
  it('reads confirmed bookings with their flights, keeps those whose every flight has arrived, earliest first, at most 100', async () => {
    const { service, bookings } = setup();

    await expect(service.completeArrived(NOW)).resolves.toBe(0);

    expect(stagesOf(bookings)).toEqual([
      { $match: { status: FlightBookingStatus.Confirmed } },
      {
        $lookup: {
          from: 'flights',
          localField: 'segments.flightId',
          foreignField: '_id',
          pipeline: [{ $project: { arrivalAt: 1, status: 1 } }],
          as: 'flights',
        },
      },
      {
        $match: {
          $expr: { $eq: [{ $size: '$flights' }, { $size: '$segments' }] },
          'flights.status': { $ne: FlightStatus.Cancelled },
        },
      },
      { $addFields: { lastArrival: { $max: '$flights.arrivalAt' } } },
      { $match: { lastArrival: { $lte: NOW } } },
      { $sort: { lastArrival: 1, _id: 1 } },
      { $limit: 100 },
      { $project: { _id: 1 } },
    ]);
    // Nothing due: no update at all.
    expect(bookings.updateMany).not.toHaveBeenCalled();
  });

  describe('which bookings are due (the conditions the pipeline sends)', () => {
    const arrived = (minutesBeforeNow: number) => ({
      arrivalAt: new Date(NOW.getTime() - minutesBeforeNow * 60_000),
      status: FlightStatus.Scheduled,
    });
    const due = (booking: Parameters<typeof isDue>[1]) => {
      const { service, bookings } = setup();
      return service
        .completeArrived(NOW)
        .then(() => isDue(stagesOf(bookings), booking));
    };

    it('a one-way booking whose flight arrived, also exactly now', async () => {
      expect(
        await due({ status: 'confirmed', segments: 1, flights: [arrived(60)] }),
      ).toBe(true);
      expect(
        await due({ status: 'confirmed', segments: 1, flights: [arrived(0)] }),
      ).toBe(true);
    });

    it('not a booking whose flight lands in a minute', async () => {
      expect(
        await due({ status: 'confirmed', segments: 1, flights: [arrived(-1)] }),
      ).toBe(false);
    });

    it('a round trip only once its return flight has arrived too', async () => {
      expect(
        await due({
          status: 'confirmed',
          segments: 2,
          flights: [arrived(9000), arrived(-60)],
        }),
      ).toBe(false);
      expect(
        await due({
          status: 'confirmed',
          segments: 2,
          flights: [arrived(9000), arrived(30)],
        }),
      ).toBe(true);
    });

    it('never a booking with a cancelled flight: the cancellation handles it', async () => {
      expect(
        await due({
          status: 'confirmed',
          segments: 1,
          flights: [{ ...arrived(60), status: FlightStatus.Cancelled }],
        }),
      ).toBe(false);
    });

    it('never a booking whose flight no longer exists', async () => {
      expect(
        await due({ status: 'confirmed', segments: 2, flights: [arrived(60)] }),
      ).toBe(false);
    });

    it('never a booking that is not confirmed', async () => {
      for (const status of [
        'pending_payment',
        'expired',
        'cancelled',
        'completed',
      ]) {
        expect(await due({ status, segments: 1, flights: [arrived(60)] })).toBe(
          false,
        );
      }
    });
  });

  it('completes the due bookings with one update that matches only those still confirmed', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    const { service, bookings } = setup(
      ids.map((_id) => ({ _id })),
      2,
    );

    await expect(service.completeArrived(NOW)).resolves.toBe(2);

    expect(bookings.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ids }, status: FlightBookingStatus.Confirmed },
      { $set: { status: FlightBookingStatus.Completed } },
    );
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.Confirmed,
        FlightBookingStatus.Completed,
      ),
    ).toBe(true);
  });

  it('counts only the bookings it changed: one cancelled in between stays cancelled', async () => {
    const { service } = setup(
      [{ _id: new Types.ObjectId() }, { _id: new Types.ObjectId() }],
      1,
    );

    await expect(service.completeArrived(NOW)).resolves.toBe(1);
  });
});

describe('FlightBookingCompletionService.completeJob (GEN-11)', () => {
  it('runs every hour', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        FlightBookingCompletionService.prototype.completeJob,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_HOUR,
      name: 'flight-booking-completion',
    });
  });

  it('runs at the current time and logs how many it completed', async () => {
    jest.useFakeTimers({ now: NOW });
    const { service, bookings } = setup([{ _id: new Types.ObjectId() }]);

    await service.completeJob();

    expect(stagesOf(bookings)[4]).toEqual({
      $match: { lastArrival: { $lte: NOW } },
    });
    expect(logInfo).toHaveBeenCalledWith('Completed 1 flight booking(s)');
  });

  it('logs nothing when nothing was due', async () => {
    const { service } = setup();

    await service.completeJob();

    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([new Error('database down'), 'database down'])(
    'catches and logs every error (%p), so the job never crashes the app',
    async (failure) => {
      const { service, aggregateExec } = setup();
      aggregateExec.mockRejectedValueOnce(failure);

      await expect(service.completeJob()).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0][1])).toContain('database down');
    },
  );
});
