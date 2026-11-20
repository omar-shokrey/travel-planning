import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from '../payments/refunds/enums/refund-status.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import { CancelledBy } from './enums/cancelled-by.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import {
  CHANGE_BOOKING_CHANGED_MESSAGE,
  DEPARTED_MESSAGE,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import type { FlightSeatsService } from './flight-seats.service';
import type { FlightChangeService } from './flight-change.service';

const BOOKING_ID = '6740f1c2a4b5c6d7e8f90aaa';
const USER_ID = '6740f1c2a4b5c6d7e8f90bbb';
const OUTBOUND_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const RETURN_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');
const NOW = new Date('2027-03-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
/** 10 days and 1 hour after NOW: 10 whole days remain. */
const DEPARTURE = new Date(NOW.getTime() + 10 * DAY_MS + 60 * 60 * 1000);

const TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 10 },
];

function segment(fields: Record<string, unknown> = {}) {
  return {
    flightId: OUTBOUND_ID,
    cabin: CabinClass.Economy,
    seatsReserved: 2,
    cancellationTiers: TIERS,
    ...fields,
  };
}

function booking(fields: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(BOOKING_ID),
    userId: new Types.ObjectId(USER_ID),
    status: FlightBookingStatus.Confirmed,
    segments: [segment()],
    total: 50_001,
    currency: 'USD',
    ...fields,
  };
}

const REFUND = {
  id: 'refund-1',
  bookingType: BookingType.Flight,
  bookingId: BOOKING_ID,
  status: RefundStatus.Pending,
  amount: 25_001,
  currency: 'USD',
  refundPercent: 50,
  reason: RefundReason.UserCancellation,
};

function setup(
  stored: unknown = booking(),
  flight: unknown = { departureAt: DEPARTURE },
) {
  const bookings = {
    findOne: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(() => Promise.resolve(stored)),
    })),
    updateOne: jest.fn(() => ({
      exec: jest.fn(() => Promise.resolve({ matchedCount: 1 })),
    })),
  };
  const select = jest.fn().mockReturnThis();
  const flights = {
    findById: jest.fn(() => ({
      select,
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(() => Promise.resolve(flight)),
    })),
  };
  const seatHolds = { unbook: jest.fn(() => Promise.resolve(true)) };
  const refunds = {
    refund: jest.fn((..._args: unknown[]) => Promise.resolve(REFUND)),
  };
  const seatAssignments = {
    releaseBooking: jest.fn((..._args: unknown[]) => Promise.resolve(2)),
  };
  // FLT-27: no flight change unless a test adds one.
  const changes = {
    paidDifferencesOf: jest.fn(
      (): Promise<{ id: string; difference: number }[]> => Promise.resolve([]),
    ),
    closeOpenChangeOf: jest.fn(() => Promise.resolve()),
    closePendingChangesTo: jest.fn(() => Promise.resolve(0)),
  };
  const service = new FlightBookingCancellationService(
    bookings as never,
    flights as never,
    seatHolds as unknown as FlightSeatHoldsService,
    refunds as unknown as RefundsService,
    seatAssignments as unknown as FlightSeatsService,
    changes as unknown as FlightChangeService,
  );
  return {
    service,
    changes,
    bookings,
    flights,
    select,
    seatHolds,
    refunds,
    seatAssignments,
  };
}

describe('FlightBookingCancellationService.preview (FLT-26)', () => {
  it('shows the refund of the tier for the whole days left, and changes nothing', async () => {
    const { service, bookings, flights, select, seatHolds, refunds } = setup();

    await expect(service.preview(BOOKING_ID, USER_ID, NOW)).resolves.toEqual({
      bookingId: BOOKING_ID,
      departureAt: DEPARTURE.toISOString(),
      daysRemaining: 10,
      refundPercent: 50,
      total: 50_001,
      refundAmount: 25_001,
      currency: 'USD',
    });
    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID,
      userId: new Types.ObjectId(USER_ID),
    });
    expect(flights.findById).toHaveBeenCalledWith(OUTBOUND_ID);
    expect(select).toHaveBeenCalledWith('departureAt status');
    expect(bookings.updateOne).not.toHaveBeenCalled();
    expect(seatHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('uses the outbound tiers and departure of a round trip, never the return ones', async () => {
    const { service, flights } = setup(
      booking({
        segments: [
          segment(),
          segment({
            flightId: RETURN_ID,
            cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
          }),
        ],
      }),
    );

    await expect(
      service.preview(BOOKING_ID, USER_ID, NOW),
    ).resolves.toMatchObject({ refundPercent: 50 });
    expect(flights.findById).toHaveBeenCalledTimes(1);
    expect(flights.findById).toHaveBeenCalledWith(OUTBOUND_ID);
  });

  it.each([
    [40, 100],
    [7, 50],
    [6, 10],
    [0, 0],
  ])('with %p whole days left the refund is %p%%', async (days, percent) => {
    const { service } = setup(booking(), {
      departureAt: new Date(NOW.getTime() + days * DAY_MS + 1000),
    });

    await expect(
      service.preview(BOOKING_ID, USER_ID, NOW),
    ).resolves.toMatchObject({ daysRemaining: days, refundPercent: percent });
  });

  it('gives 0% for a booking without copied tiers', async () => {
    const { service } = setup(
      booking({ segments: [segment({ cancellationTiers: undefined })] }),
    );

    await expect(
      service.preview(BOOKING_ID, USER_ID, NOW),
    ).resolves.toMatchObject({ refundPercent: 0, refundAmount: 0 });
  });

  it('answers 404 for a missing booking or another user’s', async () => {
    const { service, flights } = setup(null);

    const error = await service
      .preview(BOOKING_ID, USER_ID, NOW)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    expect(flights.findById).not.toHaveBeenCalled();
  });

  it.each([
    FlightBookingStatus.PendingPayment,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Cancelled,
    FlightBookingStatus.Completed,
  ])('answers 409 for a %s booking', async (status) => {
    const { service, flights } = setup(booking({ status }));

    const error = await service
      .preview(BOOKING_ID, USER_ID, NOW)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(NOT_CANCELLABLE_MESSAGE);
    expect(flights.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['has departed', { departureAt: new Date(NOW.getTime() - 1000) }],
    ['departs this very moment', { departureAt: NOW }],
    ['no longer exists', null],
  ])('answers 409 when the first flight %s', async (_case, flight) => {
    const { service } = setup(booking(), flight);

    const error = await service
      .preview(BOOKING_ID, USER_ID, NOW)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(DEPARTED_MESSAGE);
  });

  it('answers 409 when the airline cancelled the flight (FLT-06), which refunds in full', async () => {
    const { service } = setup(booking(), {
      departureAt: DEPARTURE,
      status: FlightStatus.Cancelled,
    });

    const error = await service
      .preview(BOOKING_ID, USER_ID, NOW)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE);
  });

  it('answers 409 "departed" for a booking with no segment', async () => {
    const { service, flights } = setup(booking({ segments: [] }), null);

    await expect(service.preview(BOOKING_ID, USER_ID, NOW)).rejects.toThrow(
      DEPARTED_MESSAGE,
    );
    expect(flights.findById).toHaveBeenCalledWith(undefined);
  });

  it('uses the current time by default', async () => {
    const { service } = setup(booking(), {
      departureAt: new Date(Date.now() + 3 * DAY_MS + 60_000),
    });

    await expect(service.preview(BOOKING_ID, USER_ID)).resolves.toMatchObject({
      daysRemaining: 3,
      refundPercent: 10,
    });
  });
});

describe('FlightBookingCancellationService.cancel (FLT-26)', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('cancels with one conditional update, gives the seats back, frees the chosen seats, then refunds the confirmed percent', async () => {
    const { service, bookings, seatHolds, refunds, seatAssignments } = setup();

    await expect(service.cancel(BOOKING_ID, USER_ID, 50, NOW)).resolves.toEqual(
      {
        bookingId: BOOKING_ID,
        departureAt: DEPARTURE.toISOString(),
        daysRemaining: 10,
        refundPercent: 50,
        total: 50_001,
        refundAmount: 25_001,
        currency: 'USD',
        status: FlightBookingStatus.Cancelled,
        cancelledAt: NOW.toISOString(),
        refund: {
          id: 'refund-1',
          status: RefundStatus.Pending,
          amount: 25_001,
          currency: 'USD',
          refundPercent: 50,
        },
        // FLT-27: the booking was never changed to a dearer flight.
        changeRefunds: [],
      },
    );
    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(BOOKING_ID),
        userId: new Types.ObjectId(USER_ID),
        status: FlightBookingStatus.Confirmed,
        // FLT-27: the flights and total read, so a change in between is 409.
        'segments.0.flightId': OUTBOUND_ID,
        total: 50_001,
      },
      {
        $set: {
          status: FlightBookingStatus.Cancelled,
          cancelledAt: NOW,
          cancelledBy: CancelledBy.User,
          refundPercent: 50,
        },
      },
    );
    expect(seatHolds.unbook).toHaveBeenCalledWith(
      OUTBOUND_ID,
      CabinClass.Economy,
      2,
    );
    expect(refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.Flight,
      bookingId: BOOKING_ID,
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
    });
    // FLT-28: the booking's chosen seats, by its id only.
    expect(seatAssignments.releaseBooking).toHaveBeenCalledTimes(1);
    expect(String(seatAssignments.releaseBooking.mock.calls[0][0])).toBe(
      BOOKING_ID,
    );
    expect(
      seatAssignments.releaseBooking.mock.invocationCallOrder[0],
    ).toBeGreaterThan(seatHolds.unbook.mock.invocationCallOrder[0]);
    expect(refunds.refund.mock.invocationCallOrder[0]).toBeGreaterThan(
      seatAssignments.releaseBooking.mock.invocationCallOrder[0],
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('gives back the seats of both flights of a round trip, each in its cabin', async () => {
    const { service, seatHolds } = setup(
      booking({
        segments: [
          segment(),
          segment({
            flightId: RETURN_ID,
            cabin: CabinClass.Business,
            seatsReserved: 1,
          }),
        ],
      }),
    );

    await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(seatHolds.unbook.mock.calls).toEqual([
      [OUTBOUND_ID, CabinClass.Economy, 2],
      [RETURN_ID, CabinClass.Business, 1],
    ]);
  });

  it('answers 409 "refund changed" when the refund is no longer the one confirmed, and changes nothing', async () => {
    const { service, bookings, seatHolds, refunds } = setup();

    const failure = await service
      .cancel(BOOKING_ID, USER_ID, 100, NOW)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as Error).message).toBe(REFUND_CHANGED_MESSAGE);
    expect(bookings.updateOne).not.toHaveBeenCalled();
    expect(seatHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('answers 409 when the booking was cancelled or completed in between, and gives back nothing', async () => {
    const { service, bookings, seatHolds, refunds, seatAssignments } = setup();
    bookings.updateOne.mockReturnValueOnce({
      exec: jest.fn(() => Promise.resolve({ matchedCount: 0 })),
    });
    // The read before the update, then the read after it.
    bookings.findOne
      .mockReturnValueOnce({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(() => Promise.resolve(booking())),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(() =>
          Promise.resolve(booking({ status: FlightBookingStatus.Cancelled })),
        ),
      });

    const failure = await service
      .cancel(BOOKING_ID, USER_ID, 50, NOW)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as Error).message).toBe(NOT_CANCELLABLE_MESSAGE);
    expect(seatHolds.unbook).not.toHaveBeenCalled();
    expect(seatAssignments.releaseBooking).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('answers 404 and 409 like the preview, before any change', async () => {
    const missing = setup(null);
    await expect(
      missing.service.cancel(BOOKING_ID, USER_ID, 50, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.bookings.updateOne).not.toHaveBeenCalled();

    const departed = setup(booking(), { departureAt: NOW });
    await expect(
      departed.service.cancel(BOOKING_ID, USER_ID, 0, NOW),
    ).rejects.toThrow(DEPARTED_MESSAGE);
    expect(departed.bookings.updateOne).not.toHaveBeenCalled();
  });

  it('returns refund null for a 0% refund', async () => {
    const { service, refunds } = setup(booking(), {
      departureAt: new Date(NOW.getTime() + 60_000),
    });
    refunds.refund.mockResolvedValueOnce(null as never);

    await expect(
      service.cancel(BOOKING_ID, USER_ID, 0, NOW),
    ).resolves.toMatchObject({
      refundPercent: 0,
      refundAmount: 0,
      refund: null,
    });
    expect(refunds.refund).toHaveBeenCalledWith(
      expect.objectContaining({ refundPercent: 0 }),
    );
  });

  it('keeps the cancellation and still refunds when giving the seats back fails', async () => {
    const { service, seatHolds, refunds } = setup();
    seatHolds.unbook.mockRejectedValueOnce(new Error('network') as never);

    await expect(
      service.cancel(BOOKING_ID, USER_ID, 50, NOW),
    ).resolves.toMatchObject({ status: FlightBookingStatus.Cancelled });
    expect(refunds.refund).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('were not given back');
    expect(error.mock.calls[0][1]).toEqual(expect.stringContaining('network'));
  });

  it('keeps the cancellation and still refunds when freeing the chosen seats fails (FLT-28)', async () => {
    const { service, seatAssignments, refunds } = setup();
    seatAssignments.releaseBooking.mockRejectedValueOnce(
      new Error('db down') as never,
    );

    await expect(
      service.cancel(BOOKING_ID, USER_ID, 50, NOW),
    ).resolves.toMatchObject({ status: FlightBookingStatus.Cancelled });
    expect(refunds.refund).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('chosen seats were not freed');
    expect(error.mock.calls[0][1]).toEqual(expect.stringContaining('db down'));
  });

  it('logs a non-Error failure to free the chosen seats as it is', async () => {
    const { service, seatAssignments } = setup();
    seatAssignments.releaseBooking.mockRejectedValueOnce('down' as never);

    await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(error.mock.calls[0][1]).toBe('down');
  });

  it('logs a non-Error rejection as it is', async () => {
    const { service, seatHolds } = setup();
    seatHolds.unbook.mockRejectedValueOnce('down' as never);

    await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(error.mock.calls[0][1]).toBe('down');
  });

  it('keeps the cancellation when the refund cannot be created, with refund null', async () => {
    const { service, refunds } = setup();
    refunds.refund.mockRejectedValueOnce(new Error('no payment'));

    await expect(
      service.cancel(BOOKING_ID, USER_ID, 50, NOW),
    ).resolves.toMatchObject({
      status: FlightBookingStatus.Cancelled,
      refund: null,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('refund could not be created');
    expect(error.mock.calls[0][1]).toEqual(
      expect.stringContaining('no payment'),
    );
  });

  it('logs a non-Error refund failure as it is', async () => {
    const { service, refunds } = setup();
    refunds.refund.mockRejectedValueOnce('stripe down');

    await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(error.mock.calls[0][1]).toBe('stripe down');
  });

  it('uses the current time by default', async () => {
    const { service, bookings } = setup(booking(), {
      departureAt: new Date(Date.now() + 40 * DAY_MS),
    });

    await expect(
      service.cancel(BOOKING_ID, USER_ID, 100),
    ).resolves.toMatchObject({ refundPercent: 100 });
    const update = (bookings.updateOne.mock.calls[0] as unknown[])[1] as {
      $set: { cancelledAt: Date };
    };
    expect(update.$set.cancelledAt).toBeInstanceOf(Date);
  });
});

describe('FlightBookingCancellationService after flight changes (FLT-27)', () => {
  const PAID = [
    { id: '6740f1c2a4b5c6d7e8f90c01', difference: 3 },
    { id: '6740f1c2a4b5c6d7e8f90c02', difference: 5 },
  ];

  it('shows the refund payment by payment, each rounded: the original payment and each paid difference', async () => {
    const { service, changes } = setup(booking({ total: 50_009 }));
    changes.paidDifferencesOf.mockResolvedValue(PAID);

    // round((50009 - 8) × 50%) + round(3 × 50%) + round(5 × 50%) = 25001 + 2 + 3
    await expect(
      service.preview(BOOKING_ID, USER_ID, NOW),
    ).resolves.toMatchObject({
      total: 50_009,
      refundPercent: 50,
      refundAmount: 25_006,
    });
    expect(changes.paidDifferencesOf).toHaveBeenCalledWith(
      new Types.ObjectId(BOOKING_ID),
    );
  });

  it('refunds the original payment and each paid change at the same percent, and closes the open change', async () => {
    const { service, changes, refunds } = setup(booking({ total: 50_009 }));
    changes.paidDifferencesOf.mockResolvedValue(PAID);
    refunds.refund
      .mockResolvedValueOnce(REFUND)
      .mockResolvedValueOnce({ ...REFUND, id: 'r2', amount: 2 })
      .mockResolvedValueOnce(null as never);

    const answer = await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(refunds.refund).toHaveBeenNthCalledWith(1, {
      bookingType: BookingType.Flight,
      bookingId: BOOKING_ID,
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
    });
    for (const [index, paid] of PAID.entries()) {
      expect(refunds.refund).toHaveBeenNthCalledWith(index + 2, {
        bookingType: BookingType.FlightChange,
        bookingId: paid.id,
        refundPercent: 50,
        reason: RefundReason.UserCancellation,
      });
    }
    expect(answer.changeRefunds).toEqual([
      {
        id: 'r2',
        status: RefundStatus.Pending,
        amount: 2,
        currency: 'USD',
        refundPercent: 50,
      },
    ]);
    expect(changes.closeOpenChangeOf).toHaveBeenCalledWith(
      new Types.ObjectId(BOOKING_ID),
      NOW,
    );
  });

  it('keeps the cancellation when a change refund or closing the open change fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, changes, refunds } = setup();
    changes.paidDifferencesOf.mockResolvedValue([PAID[0]]);
    changes.closeOpenChangeOf.mockRejectedValueOnce(new Error('db'));
    refunds.refund
      .mockResolvedValueOnce(REFUND)
      .mockRejectedValueOnce(new Error('db'));

    const answer = await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(answer.status).toBe(FlightBookingStatus.Cancelled);
    expect(answer.changeRefunds).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('its open flight change was not closed'),
      expect.anything(),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`flight change ${PAID[0].id}`),
      expect.anything(),
    );
    error.mockRestore();
  });

  it('closes no change and refunds no change when the conditional update matched nothing', async () => {
    const { service, changes, bookings, refunds } = setup();
    bookings.updateOne.mockReturnValueOnce({
      exec: jest.fn(() => Promise.resolve({ matchedCount: 0 })),
    });

    await expect(service.cancel(BOOKING_ID, USER_ID, 50, NOW)).rejects.toThrow(
      ConflictException,
    );
    expect(changes.closeOpenChangeOf).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('answers 409 "changed" when a flight change was applied in between (FLT-27), and gives back nothing', async () => {
    const { service, bookings, seatHolds, refunds, changes } = setup();
    bookings.updateOne.mockReturnValueOnce({
      exec: jest.fn(() => Promise.resolve({ matchedCount: 0 })),
    });

    await expect(service.cancel(BOOKING_ID, USER_ID, 50, NOW)).rejects.toThrow(
      new ConflictException(CHANGE_BOOKING_CHANGED_MESSAGE),
    );
    expect(seatHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
    expect(changes.closeOpenChangeOf).not.toHaveBeenCalled();
  });

  it('reads the paid changes again after the cancellation, so a change completed in between is refunded', async () => {
    const { service, changes, refunds } = setup();
    changes.paidDifferencesOf
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([PAID[0]]);

    await service.cancel(BOOKING_ID, USER_ID, 50, NOW);

    expect(changes.paidDifferencesOf).toHaveBeenCalledTimes(2);
    expect(refunds.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: BookingType.FlightChange,
        bookingId: PAID[0].id,
      }),
    );
  });
});
