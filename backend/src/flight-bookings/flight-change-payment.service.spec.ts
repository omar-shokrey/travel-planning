import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
} from '../payments/payments.constants';
import { FlightChangeStatus } from './enums/flight-change-status.enum';
import { FlightChangePaymentService } from './flight-change-payment.service';
import type { FlightChangeService } from './flight-change.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const CHANGE = '6740f1c2a4b5c6d7e8f90ccc';
const USER = '6740f1c2a4b5c6d7e8f90123';
const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');

const pending = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(CHANGE),
  status: FlightChangeStatus.PendingPayment,
  difference: 4200,
  currency: 'USD',
  holdExpiresAt: new Date(NOW.getTime() + 60_000),
  policyAcceptedAt: NOW,
  ...fields,
});

function setup(found: unknown) {
  const changes = {
    findOwned: jest.fn(() => Promise.resolve(found)),
    confirmPaid: jest.fn(() => Promise.resolve(true)),
    bookingOf: jest.fn(() => Promise.resolve(BOOKING)),
  };
  const port = new FlightChangePaymentService(
    changes as unknown as FlightChangeService,
  );
  return { port, changes };
}

describe('FlightChangePaymentService, the flight change port (FLT-27)', () => {
  it("gives the change's difference, currency and hold, looked up by id and owner", async () => {
    const { port, changes } = setup(pending());

    await expect(port.findPayable(CHANGE, USER, NOW)).resolves.toEqual({
      amount: 4200,
      currency: 'USD',
      holdExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(changes.findOwned).toHaveBeenCalledWith(CHANGE, USER);
  });

  it('answers 404 "Booking not found" for a missing change or someone else\'s', async () => {
    const { port } = setup(null);

    await expect(port.findPayable(CHANGE, USER, NOW)).rejects.toThrow(
      new NotFoundException('Booking not found'),
    );
  });

  it.each([
    [FlightChangeStatus.Applying],
    [FlightChangeStatus.Completed],
    [FlightChangeStatus.Expired],
  ])('answers 409 for a change that is %s', async (status) => {
    const { port } = setup(pending({ status }));

    await expect(port.findPayable(CHANGE, USER, NOW)).rejects.toThrow(
      new ConflictException(NOT_WAITING_FOR_PAYMENT_MESSAGE),
    );
  });

  it('answers 409 when the hold has ended, at the very moment too', async () => {
    const { port } = setup(pending({ holdExpiresAt: NOW }));

    await expect(port.findPayable(CHANGE, USER, NOW)).rejects.toThrow(
      new ConflictException(HOLD_EXPIRED_MESSAGE),
    );
  });

  it('confirms through the change service', async () => {
    const { port, changes } = setup(pending());

    await expect(port.confirmPaid(CHANGE, NOW)).resolves.toBe(true);
    expect(changes.confirmPaid).toHaveBeenCalledWith(CHANGE, NOW);
  });

  it('links a change to its flight booking, and an unknown one to nothing', async () => {
    const { port, changes } = setup(pending());

    await expect(port.linkOf(CHANGE)).resolves.toEqual({
      bookingType: 'flight',
      bookingId: BOOKING.toString(),
    });
    changes.bookingOf.mockResolvedValueOnce(null as never);
    await expect(port.linkOf(CHANGE)).resolves.toBeNull();
  });
});
