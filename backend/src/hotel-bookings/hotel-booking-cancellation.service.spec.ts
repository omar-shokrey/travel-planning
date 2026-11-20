import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CancelledBy } from '../flight-bookings/enums/cancelled-by.enum';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import { RefundStatus } from '../payments/refunds/enums/refund-status.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import {
  daysUntil,
  HotelBookingCancellationService,
} from './hotel-booking-cancellation.service';
import {
  CHECK_IN_REACHED_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';

const TODAY = '2027-06-03';
const NOW = new Date('2027-06-03T10:00:00.000Z');
const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

/** Confirmed, 2 rooms x 3 nights, checking in 12 days after TODAY. */
const stored = (fields: Record<string, unknown> = {}) => ({
  _id: BOOKING_ID,
  userId: USER_ID,
  status: HotelBookingStatus.Confirmed,
  checkIn: '2027-06-15',
  checkOut: '2027-06-18',
  nights: 3,
  total: 52501,
  currency: 'USD',
  rooms: [{}, {}],
  cancellationTiers: [
    { daysBefore: 2, refundPercent: 50 },
    { daysBefore: 14, refundPercent: 100 },
  ],
  ...fields,
});

function setup(found: unknown = stored(), matchedCount = 1) {
  const findOne = {
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(found),
  };
  findOne.lean.mockReturnValue(findOne);
  const bookings = {
    findOne: jest.fn(() => findOne),
    updateOne: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({ matchedCount }),
    })),
  };
  const roomHolds = {
    unbook: jest.fn<Promise<number>, unknown[]>().mockResolvedValue(6),
  };
  const refunds = {
    refund: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({
      id: 'refund-1',
      status: RefundStatus.Pending,
      amount: 26251,
      currency: 'USD',
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
    }),
  };
  const service = new HotelBookingCancellationService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
    refunds as unknown as RefundsService,
  );
  return { service, bookings, roomHolds, refunds };
}

let error: jest.SpyInstance;

beforeEach(() => {
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('daysUntil (HTL-21)', () => {
  it.each([
    ['2027-06-14', '2027-06-15', 1],
    ['2027-06-15', '2027-06-15', 0],
    ['2027-06-16', '2027-06-15', -1],
    ['2027-05-31', '2027-06-15', 15],
    ['2027-12-31', '2028-01-01', 1],
    ['2028-02-28', '2028-03-01', 2],
  ])('counts the whole days from %s to %s: %p', (today, checkIn, days) => {
    expect(daysUntil(today, checkIn)).toBe(days);
  });
});

describe('HotelBookingCancellationService.preview (HTL-21)', () => {
  it("reads the user's own reservation and quotes the refund from its copied tiers, on the full total", async () => {
    const { service, bookings } = setup();

    const quote = await service.preview(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      TODAY,
    );

    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER_ID,
    });
    // 12 days: the 2-day tier applies (50%), not the 14-day one.
    expect(quote).toEqual({
      bookingId: BOOKING_ID.toString(),
      checkIn: '2027-06-15',
      daysRemaining: 12,
      refundPercent: 50,
      total: 52501,
      // 52501 x 50 / 100 = 26250.5, rounded.
      refundAmount: 26251,
      currency: 'USD',
    });
  });

  it('changes nothing', async () => {
    const { service, bookings, roomHolds, refunds } = setup();

    await service.preview(BOOKING_ID.toString(), USER_ID.toString(), TODAY);

    expect(bookings.updateOne).not.toHaveBeenCalled();
    expect(roomHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it.each([
    ['14 or more days', '2027-06-17', 100],
    ['the day before check-in', '2027-06-04', 0],
  ])('uses the right tier for %s', async (_case, checkIn, percent) => {
    const { service } = setup(stored({ checkIn }));

    const quote = await service.preview(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      TODAY,
    );

    expect(quote.refundPercent).toBe(percent);
  });

  it('gives 0% when the hotel had no tiers', async () => {
    const { service } = setup(stored({ cancellationTiers: [] }));

    const quote = await service.preview(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      TODAY,
    );

    expect(quote).toMatchObject({ refundPercent: 0, refundAmount: 0 });
  });

  it("answers 404 for a missing reservation or someone else's", async () => {
    const { service } = setup(null);

    await expect(
      service.preview(BOOKING_ID.toString(), USER_ID.toString(), TODAY),
    ).rejects.toThrow(new NotFoundException(BOOKING_NOT_FOUND_MESSAGE));
  });

  it.each([
    HotelBookingStatus.PendingPayment,
    HotelBookingStatus.Expired,
    HotelBookingStatus.Cancelled,
    HotelBookingStatus.Completed,
  ])('answers 409 for a %s reservation', async (status) => {
    const { service } = setup(stored({ status }));

    await expect(
      service.preview(BOOKING_ID.toString(), USER_ID.toString(), TODAY),
    ).rejects.toThrow(new ConflictException(NOT_CANCELLABLE_MESSAGE));
  });

  it.each([
    ['on the check-in day', TODAY],
    ['after the check-in day', '2027-06-01'],
  ])('answers 409 %s', async (_case, checkIn) => {
    const { service } = setup(stored({ checkIn }));

    await expect(
      service.preview(BOOKING_ID.toString(), USER_ID.toString(), TODAY),
    ).rejects.toThrow(new ConflictException(CHECK_IN_REACHED_MESSAGE));
  });
});

describe('HotelBookingCancellationService.cancel (HTL-21)', () => {
  it('cancels with one conditional update, frees every night, then creates the refund', async () => {
    const { service, bookings, roomHolds, refunds } = setup();

    const result = await service.cancel(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      50,
      NOW,
      TODAY,
    );

    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: BOOKING_ID,
        userId: USER_ID,
        status: HotelBookingStatus.Confirmed,
      },
      {
        $set: {
          status: HotelBookingStatus.Cancelled,
          cancelledAt: NOW,
          cancelledBy: CancelledBy.User,
          refundPercent: 50,
        },
      },
    );
    expect(roomHolds.unbook).toHaveBeenCalledWith(BOOKING_ID);
    expect(refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.Hotel,
      bookingId: BOOKING_ID.toString(),
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
    });
    expect(result).toEqual({
      bookingId: BOOKING_ID.toString(),
      checkIn: '2027-06-15',
      daysRemaining: 12,
      refundPercent: 50,
      total: 52501,
      refundAmount: 26251,
      currency: 'USD',
      status: HotelBookingStatus.Cancelled,
      cancelledAt: NOW.toISOString(),
      refund: {
        id: 'refund-1',
        status: RefundStatus.Pending,
        amount: 26251,
        currency: 'USD',
        refundPercent: 50,
      },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('answers 409 and changes nothing when the refund is not the one the user confirmed', async () => {
    const { service, bookings, roomHolds, refunds } = setup();

    await expect(
      service.cancel(
        BOOKING_ID.toString(),
        USER_ID.toString(),
        100,
        NOW,
        TODAY,
      ),
    ).rejects.toThrow(new ConflictException(REFUND_CHANGED_MESSAGE));
    expect(bookings.updateOne).not.toHaveBeenCalled();
    expect(roomHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('answers 409 and frees nothing when another cancellation or the completion job won', async () => {
    const { service, roomHolds, refunds } = setup(stored(), 0);

    await expect(
      service.cancel(BOOKING_ID.toString(), USER_ID.toString(), 50, NOW, TODAY),
    ).rejects.toThrow(new ConflictException(NOT_CANCELLABLE_MESSAGE));
    expect(roomHolds.unbook).not.toHaveBeenCalled();
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('answers 409 for a reservation that is not confirmed, before any write', async () => {
    const { service, bookings } = setup(
      stored({ status: HotelBookingStatus.Cancelled }),
    );

    await expect(
      service.cancel(BOOKING_ID.toString(), USER_ID.toString(), 50, NOW, TODAY),
    ).rejects.toThrow(new ConflictException(NOT_CANCELLABLE_MESSAGE));
    expect(bookings.updateOne).not.toHaveBeenCalled();
  });

  it('stays cancelled and logs when fewer nights than rooms x nights were freed', async () => {
    const { service, roomHolds, refunds } = setup();
    roomHolds.unbook.mockResolvedValueOnce(4);

    await expect(
      service.cancel(BOOKING_ID.toString(), USER_ID.toString(), 50, NOW, TODAY),
    ).resolves.toMatchObject({ status: HotelBookingStatus.Cancelled });

    expect(error.mock.calls[0][0]).toBe(
      `Reservation ${BOOKING_ID.toString()} is cancelled, but 4 of its 6 booked nights were released`,
    );
    expect(refunds.refund).toHaveBeenCalledTimes(1);
  });

  it('stays cancelled and still creates the refund when freeing the nights fails', async () => {
    const { service, roomHolds, refunds } = setup();
    roomHolds.unbook.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      service.cancel(BOOKING_ID.toString(), USER_ID.toString(), 50, NOW, TODAY),
    ).resolves.toMatchObject({ status: HotelBookingStatus.Cancelled });
    expect(error).toHaveBeenCalledTimes(1);
    expect(refunds.refund).toHaveBeenCalledTimes(1);
  });

  it('stays cancelled with no refund in the answer when creating the refund fails', async () => {
    const { service, refunds } = setup();
    refunds.refund.mockRejectedValueOnce(new Error('database down'));

    const result = await service.cancel(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      50,
      NOW,
      TODAY,
    );

    expect(result).toMatchObject({
      status: HotelBookingStatus.Cancelled,
      refund: null,
    });
    expect(error.mock.calls[0][0]).toBe(
      `Reservation ${BOOKING_ID.toString()} is cancelled, but its refund could not be created`,
    );
  });

  it('answers refund null when nothing is refunded (0%)', async () => {
    const { service, refunds } = setup(stored({ cancellationTiers: [] }));
    refunds.refund.mockResolvedValueOnce(null);

    const result = await service.cancel(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      0,
      NOW,
      TODAY,
    );

    expect(result).toMatchObject({ refundPercent: 0, refund: null });
  });
});
