import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';
import { HOTEL_BOOKING_EXPIRY_BATCH } from './hotel-bookings.constants';

const NOW = new Date('2026-11-17T18:00:00.000Z');

const setup = (
  dueIds: Types.ObjectId[],
  modified: (id: Types.ObjectId) => number,
) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(dueIds.map((_id) => ({ _id }))),
  };
  for (const step of ['select', 'sort', 'limit', 'lean'] as const) {
    chain[step].mockReturnValue(chain);
  }
  const bookings = {
    find: jest.fn().mockReturnValue(chain),
    updateOne: jest.fn((filter: { _id: Types.ObjectId }) => ({
      exec: jest
        .fn()
        .mockResolvedValue({ modifiedCount: modified(filter._id) }),
    })),
  };
  const roomHolds = { release: jest.fn().mockResolvedValue(undefined) };
  const service = new HotelBookingExpiryService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
  );
  return { service, bookings, roomHolds, chain };
};

describe('HotelBookingExpiryService (HTL-18, GEN-11)', () => {
  it('looks for pending reservations whose hold has ended, one batch at a time', async () => {
    const { service, bookings, chain } = setup([], () => 0);

    expect(await service.expireHolds(NOW)).toBe(0);
    expect(bookings.find).toHaveBeenCalledWith({
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: { $lte: NOW },
    });
    expect(chain.limit).toHaveBeenCalledWith(HOTEL_BOOKING_EXPIRY_BATCH);
  });

  it('expires each one only if it is still pending, then releases its rooms', async () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const { service, bookings, roomHolds } = setup([a, b], () => 1);

    expect(await service.expireHolds(NOW)).toBe(2);
    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: a,
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt: { $lte: NOW },
      },
      { $set: { status: HotelBookingStatus.Expired } },
    );
    expect(roomHolds.release.mock.calls).toEqual([[a], [b]]);
  });

  it('leaves the rooms of a reservation that was paid in the meantime', async () => {
    const paid = new Types.ObjectId();
    const unpaid = new Types.ObjectId();
    const { service, roomHolds } = setup([paid, unpaid], (id) =>
      id.equals(paid) ? 0 : 1,
    );

    expect(await service.expireHolds(NOW)).toBe(1);
    expect(roomHolds.release.mock.calls).toEqual([[unpaid]]);
  });

  it('logs an error of a timed run instead of throwing it', async () => {
    const { service, bookings } = setup([], () => 0);
    bookings.find.mockImplementation(() => {
      throw new Error('database down');
    });
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.run()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      'Could not expire unpaid hotel reservations',
      expect.stringContaining('database down'),
    );
    log.mockRestore();
  });
});
