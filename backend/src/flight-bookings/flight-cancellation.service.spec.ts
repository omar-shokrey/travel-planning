import { ConflictException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import type { FlightsService } from '../flights/flights.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../notifications/notifications.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import { CancelledBy } from './enums/cancelled-by.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE } from './flight-bookings.constants';
import { FlightCancellationService } from './flight-cancellation.service';
import type { FlightSeatsService } from './flight-seats.service';
import type { FlightChangeService } from './flight-change.service';

const FLIGHT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const RETURN_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90457');
const NOW = new Date('2027-01-01T00:00:00.000Z');

const flight = {
  _id: FLIGHT_ID,
  airlineId: new Types.ObjectId(),
  flightNumber: 'MS777',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureDateLocal: '2027-01-10',
  departureAt: new Date('2027-01-10T08:00:00.000Z'),
  arrivalAt: new Date('2027-01-10T20:00:00.000Z'),
  status: FlightStatus.Cancelled,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

const booking = (
  status: FlightBookingStatus,
  segments: { flightId: Types.ObjectId; cabin: CabinClass; seats: number }[] = [
    { flightId: FLIGHT_ID, cabin: CabinClass.Economy, seats: 2 },
  ],
) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  reference: 'FB7K2Q9M',
  status,
  total: 50000,
  currency: 'USD',
  segments: segments.map(({ flightId, cabin, seats }) => ({
    flightId,
    cabin,
    seatsReserved: seats,
  })),
});

function setup(affected: unknown[] = [], matched = 1) {
  const select = jest.fn().mockReturnThis();
  const bookings = {
    find: jest.fn((..._args: unknown[]) => ({
      select,
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(affected),
    })),
    updateOne: jest.fn((..._args: unknown[]) => ({
      exec: () => Promise.resolve({ matchedCount: matched }),
    })),
    aggregate: jest.fn((..._args: unknown[]) => ({
      exec: () => Promise.resolve([] as unknown[]),
    })),
  };
  const flights = {
    collection: { collectionName: 'flights' },
    findById: jest.fn((..._args: unknown[]) => ({
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(flight as unknown),
    })),
  };
  const flightsService = {
    cancel: jest.fn((..._args: unknown[]) => Promise.resolve(flight)),
  };
  const flightResponses = {
    toResponse: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ id: FLIGHT_ID.toString(), status: 'cancelled' }),
    ),
  };
  const seatHolds = {
    unbook: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
    release: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
  };
  const refunds = {
    refund: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
  };
  const notifications = {
    notify: jest.fn((..._args: unknown[]) => Promise.resolve()),
  };
  const seatAssignments = {
    releaseBooking: jest.fn((..._args: unknown[]) => Promise.resolve(1)),
  };
  // FLT-27: no flight change unless a test adds one.
  const changes = {
    paidDifferencesOf: jest.fn(
      (): Promise<{ id: string; difference: number }[]> => Promise.resolve([]),
    ),
    closeOpenChangeOf: jest.fn(() => Promise.resolve()),
    closePendingChangesTo: jest.fn(() => Promise.resolve(0)),
  };
  const service = new FlightCancellationService(
    bookings as never,
    flights as never,
    flightsService as unknown as FlightsService,
    flightResponses as unknown as FlightResponsesService,
    seatHolds as unknown as FlightSeatHoldsService,
    refunds as unknown as RefundsService,
    notifications as unknown as NotificationsService,
    seatAssignments as unknown as FlightSeatsService,
    changes as unknown as FlightChangeService,
  );
  return {
    service,
    changes,
    bookings,
    select,
    flights,
    flightsService,
    flightResponses,
    seatHolds,
    refunds,
    notifications,
    seatAssignments,
  };
}

let logError: jest.SpyInstance;
let logInfo: jest.SpyInstance;
beforeEach(() => {
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  logInfo = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});
afterEach(() => {
  logError.mockRestore();
  logInfo.mockRestore();
});

describe('FlightCancellationService.cancelFlight (FLT-06)', () => {
  it('cancels the flight, then its bookings, and answers the flight with the counts', async () => {
    const confirmed = booking(FlightBookingStatus.Confirmed);
    const held = booking(FlightBookingStatus.PendingPayment);
    const { service, flightsService, flightResponses } = setup([
      confirmed,
      held,
    ]);

    await expect(
      service.cancelFlight(FLIGHT_ID.toString(), 'moderator-1', NOW),
    ).resolves.toEqual({
      flight: { id: FLIGHT_ID.toString(), status: 'cancelled' },
      cancelledBookings: 1,
      expiredHolds: 1,
    });
    expect(flightsService.cancel).toHaveBeenCalledWith(
      FLIGHT_ID.toString(),
      'moderator-1',
      NOW,
    );
    expect(flightResponses.toResponse).toHaveBeenCalledWith(flight, NOW);
  });

  it('changes no booking when the flight cannot be cancelled', async () => {
    const { service, flightsService, bookings } = setup();
    flightsService.cancel.mockRejectedValueOnce(new ConflictException('no'));

    await expect(
      service.cancelFlight(FLIGHT_ID.toString(), 'moderator-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bookings.find).not.toHaveBeenCalled();
  });

  it('uses the current time by default', async () => {
    const { service, flightsService } = setup();

    await service.cancelFlight(FLIGHT_ID.toString(), 'moderator-1');

    expect(flightsService.cancel.mock.calls[0][2]).toBeInstanceOf(Date);
  });
});

describe('FlightCancellationService.cascade (FLT-06)', () => {
  it('reads the confirmed bookings and holds with a segment on the flight', async () => {
    const { service, bookings, select } = setup();

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 0,
      expiredHolds: 0,
    });
    expect(bookings.find).toHaveBeenCalledWith({
      'segments.flightId': FLIGHT_ID,
      status: {
        $in: [
          FlightBookingStatus.Confirmed,
          FlightBookingStatus.PendingPayment,
        ],
      },
    });
    expect(select).toHaveBeenCalledWith(
      'userId reference status segments total currency',
    );
  });

  it('cancels a confirmed booking by the provider with a 100% refund, gives every seat back, frees its chosen seats and notifies its owner', async () => {
    const roundTrip = booking(FlightBookingStatus.Confirmed, [
      { flightId: FLIGHT_ID, cabin: CabinClass.Economy, seats: 2 },
      { flightId: RETURN_ID, cabin: CabinClass.Business, seats: 2 },
    ]);
    const {
      service,
      bookings,
      seatHolds,
      refunds,
      notifications,
      seatAssignments,
    } = setup([roundTrip]);

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 1,
      expiredHolds: 0,
    });

    expect(bookings.updateOne).toHaveBeenCalledWith(
      { _id: roundTrip._id, status: FlightBookingStatus.Confirmed },
      {
        $set: {
          status: FlightBookingStatus.Cancelled,
          cancelledAt: NOW,
          cancelledBy: CancelledBy.Provider,
          refundPercent: 100,
        },
      },
    );
    expect(seatHolds.unbook.mock.calls).toEqual([
      [FLIGHT_ID, CabinClass.Economy, 2],
      [RETURN_ID, CabinClass.Business, 2],
    ]);
    // FLT-28: one call for the whole booking, by its id.
    expect(seatAssignments.releaseBooking.mock.calls).toEqual([
      [roundTrip._id],
    ]);
    expect(refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: roundTrip._id.toString(),
      refundPercent: 100,
      reason: RefundReason.FlightCancelled,
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      roundTrip.userId,
      NotificationType.BookingCancelled,
      'The airline cancelled flight MS777 CAI to JFK on 2027-01-10. Your booking FB7K2Q9M is cancelled and refunded in full (USD 500.00).',
      {
        type: NotificationLinkType.FlightBooking,
        id: roundTrip._id.toString(),
      },
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('expires a hold, releases its seats and frees any chosen seat, with no refund or notification', async () => {
    const held = booking(FlightBookingStatus.PendingPayment);
    const {
      service,
      bookings,
      seatHolds,
      refunds,
      notifications,
      seatAssignments,
    } = setup([held]);

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 0,
      expiredHolds: 1,
    });
    expect(bookings.updateOne).toHaveBeenCalledWith(
      { _id: held._id, status: FlightBookingStatus.PendingPayment },
      { $set: { status: FlightBookingStatus.Expired } },
    );
    expect(seatHolds.release).toHaveBeenCalledWith(
      FLIGHT_ID,
      CabinClass.Economy,
      2,
    );
    expect(seatAssignments.releaseBooking).toHaveBeenCalledWith(held._id);
    expect(refunds.refund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does nothing more for a booking another request changed first', async () => {
    const { service, seatHolds, refunds, notifications, seatAssignments } =
      setup(
        [
          booking(FlightBookingStatus.Confirmed),
          booking(FlightBookingStatus.PendingPayment),
        ],
        0,
      );

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 0,
      expiredHolds: 0,
    });
    expect(seatHolds.unbook).not.toHaveBeenCalled();
    expect(seatHolds.release).not.toHaveBeenCalled();
    expect(seatAssignments.releaseBooking).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('keeps the cancellation when the seats, the chosen seats, the refund or the notification fail, and logs each', async () => {
    const { service, seatHolds, refunds, notifications, seatAssignments } =
      setup([
        booking(FlightBookingStatus.Confirmed),
        booking(FlightBookingStatus.PendingPayment),
      ]);
    seatHolds.unbook.mockRejectedValueOnce(new Error('seats down'));
    seatHolds.release.mockRejectedValueOnce('release down');
    seatAssignments.releaseBooking
      .mockRejectedValueOnce(new Error('chosen down'))
      .mockRejectedValueOnce(new Error('chosen down again'));
    refunds.refund.mockRejectedValueOnce(new Error('stripe down'));
    notifications.notify.mockRejectedValueOnce(new Error('notify down'));

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 1,
      expiredHolds: 1,
    });
    const logged = logError.mock.calls.map((call) => String(call[0]));
    expect(logged).toEqual([
      expect.stringContaining('its seats failed'),
      expect.stringContaining('its chosen seats (FLT-28) failed'),
      expect.stringContaining('its refund failed'),
      expect.stringContaining('its notification failed'),
      expect.stringContaining('its seats failed'),
      expect.stringContaining('its chosen seats (FLT-28) failed'),
    ]);
    expect(logError.mock.calls[4][1]).toBe('release down');
  });

  it('goes on with the other bookings when one update fails, leaving it to the sweep', async () => {
    const { service, bookings } = setup([
      booking(FlightBookingStatus.Confirmed),
      booking(FlightBookingStatus.Confirmed),
    ]);
    bookings.updateOne.mockImplementationOnce(() => ({
      exec: () => Promise.reject(new Error('db down')),
    }));
    bookings.updateOne.mockImplementationOnce(() => ({
      exec: () => Promise.reject('db down'),
    }));

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 0,
      expiredHolds: 0,
    });
    expect(String(logError.mock.calls[0][0])).toContain(
      'the sweep tries again',
    );
    expect(logError.mock.calls[1][1]).toBe('db down');
  });
});

describe('FlightCancellationService.sweep (FLT-06)', () => {
  it('finds the bookings left on cancelled flights and finishes each flight’s cascade', async () => {
    const { service, bookings, flights } = setup([
      booking(FlightBookingStatus.Confirmed),
    ]);
    bookings.aggregate.mockReturnValueOnce({
      exec: () => Promise.resolve([{ _id: FLIGHT_ID }]),
    });

    await expect(service.sweep(NOW)).resolves.toEqual({
      cancelledBookings: 1,
      expiredHolds: 0,
    });
    expect(bookings.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          status: {
            $in: [
              FlightBookingStatus.Confirmed,
              FlightBookingStatus.PendingPayment,
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'flights',
          localField: 'segments.flightId',
          foreignField: '_id',
          pipeline: [
            { $match: { status: FlightStatus.Cancelled } },
            { $project: { _id: 1 } },
          ],
          as: 'cancelledFlights',
        },
      },
      { $match: { 'cancelledFlights.0': { $exists: true } } },
      { $limit: FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE },
      { $unwind: '$cancelledFlights' },
      { $group: { _id: '$cancelledFlights._id' } },
    ]);
    expect(flights.findById).toHaveBeenCalledWith(FLIGHT_ID);
  });

  it('skips a flight that no longer exists', async () => {
    const { service, bookings, flights } = setup();
    bookings.aggregate.mockReturnValueOnce({
      exec: () => Promise.resolve([{ _id: FLIGHT_ID }]),
    });
    flights.findById.mockReturnValueOnce({
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(null),
    });

    await expect(service.sweep(NOW)).resolves.toEqual({
      cancelledBookings: 0,
      expiredHolds: 0,
    });
    expect(bookings.find).not.toHaveBeenCalled();
  });
});

describe('FlightCancellationService.sweepJob (FLT-06)', () => {
  it('logs what it finished', async () => {
    const { service } = setup();
    jest
      .spyOn(service, 'sweep')
      .mockResolvedValueOnce({ cancelledBookings: 2, expiredHolds: 1 });

    await service.sweepJob();

    expect(String(logInfo.mock.calls[0][0])).toContain(
      '2 booking(s) and 1 hold(s)',
    );
  });

  it('logs nothing when there was nothing left', async () => {
    const { service } = setup();

    await service.sweepJob();

    expect(logInfo).not.toHaveBeenCalled();
  });

  it('never throws: an error is logged', async () => {
    const { service } = setup();
    jest.spyOn(service, 'sweep').mockRejectedValueOnce(new Error('db down'));
    await service.sweepJob();
    jest.spyOn(service, 'sweep').mockRejectedValueOnce('down');
    await service.sweepJob();

    expect(String(logError.mock.calls[0][0])).toContain('sweep failed');
    expect(logError.mock.calls[1][1]).toBe('down');
  });
});

describe('FlightCancellationService and flight changes (FLT-27)', () => {
  it('closes the changes waiting for payment to the cancelled flight before its bookings', async () => {
    const { service, changes, bookings } = setup([]);

    await service.cascade(flight, NOW);

    expect(changes.closePendingChangesTo).toHaveBeenCalledWith(FLIGHT_ID, NOW);
    expect(
      changes.closePendingChangesTo.mock.invocationCallOrder[0],
    ).toBeLessThan(bookings.find.mock.invocationCallOrder[0]);
  });

  it('closes the open change of a cancelled booking and refunds each paid change in full', async () => {
    const confirmed = booking(FlightBookingStatus.Confirmed);
    const { service, changes, refunds } = setup([confirmed]);
    changes.paidDifferencesOf.mockResolvedValueOnce([
      { id: '6740f1c2a4b5c6d7e8f90c01', difference: 4200 },
    ]);

    await service.cascade(flight, NOW);

    expect(changes.closeOpenChangeOf).toHaveBeenCalledWith(confirmed._id, NOW);
    expect(refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: confirmed._id.toString(),
      refundPercent: 100,
      reason: RefundReason.FlightCancelled,
    });
    expect(refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.FlightChange,
      bookingId: '6740f1c2a4b5c6d7e8f90c01',
      refundPercent: 100,
      reason: RefundReason.FlightCancelled,
    });
  });

  it('keeps the cancellation when closing the changes or a change refund fails, and logs it', async () => {
    const confirmed = booking(FlightBookingStatus.Confirmed);
    const { service, changes, refunds } = setup([confirmed]);
    changes.closePendingChangesTo.mockRejectedValueOnce(new Error('db'));
    changes.closeOpenChangeOf.mockRejectedValueOnce(new Error('db'));
    changes.paidDifferencesOf.mockResolvedValueOnce([
      { id: '6740f1c2a4b5c6d7e8f90c01', difference: 4200 },
    ]);
    refunds.refund
      .mockResolvedValueOnce(null as never)
      .mockRejectedValueOnce(new Error('db'));

    await expect(service.cascade(flight, NOW)).resolves.toEqual({
      cancelledBookings: 1,
      expiredHolds: 0,
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('flight changes waiting for payment'),
      expect.anything(),
    );
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('open flight change (FLT-27)'),
      expect.anything(),
    );
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('refund of flight change'),
      expect.anything(),
    );
  });

  it('refunds no change of a hold that expires', async () => {
    const { service, changes } = setup([
      booking(FlightBookingStatus.PendingPayment),
    ]);

    await service.cascade(flight, NOW);

    expect(changes.paidDifferencesOf).not.toHaveBeenCalled();
  });
});
