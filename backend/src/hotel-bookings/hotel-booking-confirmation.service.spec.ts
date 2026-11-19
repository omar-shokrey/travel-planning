import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import type { HotelsService } from '../hotels/hotels.service';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../notifications/notifications.service';
import { HOTEL_REFERENCE_PATTERN } from './booking-reference';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingConfirmationService } from './hotel-booking-confirmation.service';
import {
  CONFIRM_NIGHTS_GRACE_MINUTES,
  REFERENCE_ATTEMPTS,
} from './hotel-bookings.constants';

const NOW = new Date('2027-06-01T10:00:00.000Z');
const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const HOTEL_ID = new Types.ObjectId();

const duplicateKey = (): Error =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

/** The reservation as the confirming update returns it: 2 rooms x 3 nights. */
const confirmedBooking = () => ({
  _id: BOOKING_ID,
  userId: USER_ID,
  hotelId: HOTEL_ID,
  status: HotelBookingStatus.Confirmed,
  reference: 'HB-7KQ2MX',
  checkIn: '2027-06-15',
  checkOut: '2027-06-18',
  nights: 3,
  rooms: [
    { roomLabel: '101 (Double)', adults: 2, childAges: [] },
    { roomLabel: '102 (Family)', adults: 1, childAges: [7] },
  ],
});

interface Chain {
  select: jest.Mock<Chain, []>;
  lean: jest.Mock<Chain, []>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const query = (result: () => Promise<unknown>) => {
  const chain: Chain = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(result),
  };
  return chain;
};

function setup(
  options: {
    /** What each confirming update gives, in order: a reservation, null, or an error. */
    updates?: unknown[];
    /** What the first read of the reservation finds (default: pending, 2 rooms x 3 nights). */
    initial?: unknown;
    /** What the read after a non-match finds. */
    found?: unknown;
    /** How many nights `secureHold` keeps (default 6, every night). */
    secured?: number;
    /** How many nights `confirm` changes. */
    booked?: number;
  } = {},
) {
  const calls: string[] = [];
  const updates = [...(options.updates ?? [confirmedBooking()])];
  const reads: unknown[] = [
    options.initial === undefined
      ? { rooms: confirmedBooking().rooms, nights: 3 }
      : options.initial,
    options.found ?? null,
  ];
  const bookings = {
    findOneAndUpdate: jest.fn(() => {
      calls.push('confirm reservation');
      return query(() => {
        const next = updates.shift() ?? null;
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next);
      });
    }),
    findById: jest.fn(() => {
      const read = reads.shift();
      return query(() => Promise.resolve(read ?? null));
    }),
  };
  const roomHolds = {
    secureHold: jest.fn<Promise<number>, unknown[]>(() => {
      calls.push('secure nights');
      return Promise.resolve(options.secured ?? 6);
    }),
    confirm: jest.fn<Promise<number>, unknown[]>(() => {
      calls.push('book nights');
      return Promise.resolve(options.booked ?? 6);
    }),
    release: jest.fn<Promise<void>, unknown[]>(() => Promise.resolve()),
  };
  const hotels = {
    findEntityOrThrow: jest.fn<Promise<unknown>, unknown[]>(() =>
      Promise.resolve({ name: 'Nile Hotel' }),
    ),
  };
  const notifications = {
    notify: jest.fn<Promise<void>, unknown[]>(() => {
      calls.push('notify');
      return Promise.resolve();
    }),
  };
  const service = new HotelBookingConfirmationService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
    hotels as unknown as HotelsService,
    notifications as unknown as NotificationsService,
  );
  return { service, bookings, roomHolds, hotels, notifications, calls };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('HotelBookingConfirmationService.confirmPaid (HTL-17)', () => {
  it('keeps the nights, confirms with one conditional update and a reference, books the nights, then notifies', async () => {
    const { service, bookings, roomHolds, calls } = setup();

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(calls).toEqual([
      'secure nights',
      'confirm reservation',
      'book nights',
      'notify',
    ]);
    expect(roomHolds.secureHold).toHaveBeenCalledWith(
      BOOKING_ID,
      new Date(NOW.getTime() + CONFIRM_NIGHTS_GRACE_MINUTES * 60_000),
      NOW,
    );
    const [filter, update, options] = bookings.findOneAndUpdate.mock
      .calls[0] as unknown as [
      Record<string, unknown>,
      { $set: { status: string; reference: string } },
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      _id: BOOKING_ID,
      status: HotelBookingStatus.PendingPayment,
      holdExpiresAt: { $gt: NOW },
    });
    expect(update.$set.status).toBe(HotelBookingStatus.Confirmed);
    expect(update.$set.reference).toMatch(HOTEL_REFERENCE_PATTERN);
    expect(options).toEqual({ returnDocument: 'after' });
    expect(roomHolds.confirm).toHaveBeenCalledWith(BOOKING_ID);
    expect(error).not.toHaveBeenCalled();
    // The reservation was read first, for its rooms x nights.
    expect(bookings.findById).toHaveBeenCalledWith(BOOKING_ID);
  });

  it('notifies the owner once with the reservation details and a link to it', async () => {
    const { service, notifications } = setup();

    await service.confirmPaid(BOOKING_ID.toString(), NOW);

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      USER_ID,
      NotificationType.BookingConfirmed,
      'Your reservation HB-7KQ2MX at Nile Hotel is confirmed: check-in 2027-06-15, check-out 2027-06-18 (3 nights), 2 rooms (101 (Double), 102 (Family)), 3 adults and 1 child.',
      { type: NotificationLinkType.HotelBooking, id: BOOKING_ID },
    );
  });

  it('logs an error with the reservation id when not every night (rooms x nights) became booked, and stays confirmed', async () => {
    const { service } = setup({ booked: 4 });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain(
      `Hotel reservation ${BOOKING_ID.toString()} is confirmed but 4 of its 6 nights`,
    );
  });

  it('rethrows a failure while booking the nights, so Stripe sends the event again; the confirmation is not undone and nothing is sent', async () => {
    const { service, bookings, roomHolds, notifications } = setup();
    const failure = new Error('write failed');
    roomHolds.confirm.mockRejectedValueOnce(failure);

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).rejects.toBe(
      failure,
    );
    // Only the confirming update ran: nothing set the reservation back.
    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(roomHolds.release).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('is idempotent: a reservation confirmed before answers true, books any night still held, and sends no second notification', async () => {
    const confirmedBefore = {
      reference: 'HB-7KQ2MX',
      status: HotelBookingStatus.Confirmed,
    };
    const { service, bookings, roomHolds, notifications } = setup({
      initial: confirmedBefore,
      found: confirmedBefore,
      booked: 0,
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(roomHolds.confirm).toHaveBeenCalledWith(BOOKING_ID);
    expect(roomHolds.secureHold).not.toHaveBeenCalled();
    expect(bookings.findOneAndUpdate).not.toHaveBeenCalled();
    expect(roomHolds.release).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('answers true when a delivery at the same moment confirmed it first, and books any night still held', async () => {
    const { service, roomHolds, notifications } = setup({
      updates: [null],
      found: { reference: 'HB-7KQ2MX', status: HotelBookingStatus.Confirmed },
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );
    expect(roomHolds.confirm).toHaveBeenCalledWith(BOOKING_ID);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not confirm when not every night is still its own (another hold took some just after the hold ended): late, released', async () => {
    const { service, bookings, roomHolds, notifications } = setup({
      secured: 4,
      found: { status: HotelBookingStatus.PendingPayment },
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      false,
    );

    expect(bookings.findOneAndUpdate).not.toHaveBeenCalled();
    expect(roomHolds.confirm).not.toHaveBeenCalled();
    expect(roomHolds.release).toHaveBeenCalledWith(BOOKING_ID);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('answers false and releases when every night is kept but the update does not match (no longer pending)', async () => {
    const { service, roomHolds } = setup({
      updates: [null],
      found: { status: HotelBookingStatus.Cancelled },
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      false,
    );
    expect(roomHolds.release).toHaveBeenCalledWith(BOOKING_ID);
  });

  it.each([
    ['expired', { status: HotelBookingStatus.Expired }],
    [
      'pending with an ended hold',
      { status: HotelBookingStatus.PendingPayment },
    ],
  ])(
    'answers false for a late payment (%s): not confirmed, its held nights released, nothing sent',
    async (_case, found) => {
      const { service, bookings, roomHolds, notifications } = setup({
        secured: 0,
        found,
      });

      await expect(
        service.confirmPaid(BOOKING_ID.toString(), NOW),
      ).resolves.toBe(false);

      expect(bookings.findOneAndUpdate).not.toHaveBeenCalled();
      expect(roomHolds.confirm).not.toHaveBeenCalled();
      expect(roomHolds.release).toHaveBeenCalledWith(BOOKING_ID);
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('answers false and warns for an unknown reservation', async () => {
    const { service, roomHolds } = setup({ initial: null });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      false,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(roomHolds.secureHold).not.toHaveBeenCalled();
    expect(roomHolds.release).not.toHaveBeenCalled();
  });

  it('answers false for an invalid id without touching anything', async () => {
    const { service, bookings, roomHolds } = setup();

    await expect(service.confirmPaid('not-an-id', NOW)).resolves.toBe(false);
    expect(roomHolds.secureHold).not.toHaveBeenCalled();
    expect(bookings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('tries a new reference when the first one is taken', async () => {
    const { service, bookings } = setup({
      updates: [duplicateKey(), confirmedBooking()],
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );
    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${REFERENCE_ATTEMPTS} taken references, so Stripe sends the event again`, async () => {
    const { service, bookings } = setup({
      updates: Array.from({ length: REFERENCE_ATTEMPTS }, duplicateKey),
    });

    await expect(
      service.confirmPaid(BOOKING_ID.toString(), NOW),
    ).rejects.toMatchObject({ code: 11000 });
    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(REFERENCE_ATTEMPTS);
  });

  it('rethrows a database error, so Stripe sends the event again', async () => {
    const down = new Error('database down');
    const { service } = setup({ updates: [down] });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).rejects.toBe(
      down,
    );
  });

  it.each([
    ['reading the hotel', 'hotels'],
    ['sending', 'notifications'],
  ] as const)(
    'stays confirmed when %s fails: it is logged with the reservation id only',
    async (_case, failing) => {
      const s = setup();
      if (failing === 'hotels') {
        s.hotels.findEntityOrThrow.mockRejectedValueOnce(new Error('gone'));
      } else {
        s.notifications.notify.mockRejectedValueOnce(
          new Error('insert failed'),
        );
      }

      await expect(
        s.service.confirmPaid(BOOKING_ID.toString(), NOW),
      ).resolves.toBe(true);

      expect(error.mock.calls[0][0]).toBe(
        `Hotel reservation ${BOOKING_ID.toString()} is confirmed, but its notification was not sent`,
      );
    },
  );
});
