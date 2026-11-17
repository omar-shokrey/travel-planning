import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingCompletionService } from './hotel-booking-completion.service';
import { HOTEL_BOOKING_COMPLETION_BATCH } from './hotel-bookings.constants';

const TODAY = '2026-11-17';

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
  const service = new HotelBookingCompletionService(bookings as never);
  return { service, bookings, chain };
};

describe('HotelBookingCompletionService (HTL-23, GEN-11)', () => {
  it('looks for confirmed stays whose check-out date has passed, one batch at a time', async () => {
    const { service, bookings, chain } = setup([], () => 0);

    expect(await service.completeStays(TODAY)).toBe(0);
    expect(bookings.find).toHaveBeenCalledWith({
      status: HotelBookingStatus.Confirmed,
      checkOut: { $lt: TODAY },
    });
    expect(chain.limit).toHaveBeenCalledWith(HOTEL_BOOKING_COMPLETION_BATCH);
  });

  it('completes each one only if it is still confirmed', async () => {
    const done = new Types.ObjectId();
    const cancelled = new Types.ObjectId();
    const { service, bookings } = setup([done, cancelled], (id) =>
      id.equals(done) ? 1 : 0,
    );

    expect(await service.completeStays(TODAY)).toBe(1);
    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: done,
        status: HotelBookingStatus.Confirmed,
        checkOut: { $lt: TODAY },
      },
      { $set: { status: HotelBookingStatus.Completed } },
    );
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
      'Could not complete finished hotel reservations',
      expect.stringContaining('database down'),
    );
    log.mockRestore();
  });
});
