import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../notifications/notifications.service';
import { FLIGHT_REFERENCE_PATTERN } from './booking-reference';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightBookingConfirmationService } from './flight-booking-confirmation.service';
import { REFERENCE_ATTEMPTS } from './flight-bookings.constants';

const NOW = new Date('2027-06-01T10:00:00.000Z');
const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const OUTBOUND_ID = new Types.ObjectId();
const RETURN_ID = new Types.ObjectId();

const duplicateKey = (): Error =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

/** The booking as the confirming update returns it. */
const confirmedBooking = (roundTrip = false) => ({
  _id: BOOKING_ID,
  userId: USER_ID,
  status: FlightBookingStatus.Confirmed,
  reference: 'FB-7KQ2MX',
  passengerCounts: { adults: 2, children: 0, infants: 1 },
  segments: [
    { flightId: OUTBOUND_ID, cabin: CabinClass.Economy, seatsReserved: 2 },
    ...(roundTrip
      ? [{ flightId: RETURN_ID, cabin: CabinClass.Business, seatsReserved: 2 }]
      : []),
  ],
});

const storedFlights = [
  {
    _id: OUTBOUND_ID,
    flightNumber: 'NP123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: new Date('2027-06-15T11:30:00.000Z'),
  },
  {
    _id: RETURN_ID,
    flightNumber: 'NP124',
    departureAirport: 'JFK',
    arrivalAirport: 'CAI',
    departureAt: new Date('2027-06-22T22:05:00.000Z'),
  },
];

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
    /** What each confirming update gives, in order: a booking, null, or an error. */
    updates?: unknown[];
    /** What the read after a non-matching update finds. */
    found?: unknown;
  } = {},
) {
  const updates = [...(options.updates ?? [confirmedBooking()])];
  const bookings = {
    findOneAndUpdate: jest.fn(() =>
      query(() => {
        const next = updates.shift() ?? null;
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next);
      }),
    ),
    findById: jest.fn(() =>
      query(() => Promise.resolve(options.found ?? null)),
    ),
  };
  const flights = {
    find: jest.fn(() => query(() => Promise.resolve(storedFlights))),
  };
  const seatHolds = {
    confirm: jest.fn<Promise<boolean>, unknown[]>(() => Promise.resolve(true)),
  };
  const flightResponses = {
    timeZonesOf: jest.fn(() =>
      Promise.resolve(
        new Map([
          ['CAI', 'Africa/Cairo'],
          ['JFK', 'America/New_York'],
        ]),
      ),
    ),
  };
  const notifications = {
    notify: jest.fn<Promise<void>, unknown[]>(() => Promise.resolve()),
  };
  const service = new FlightBookingConfirmationService(
    bookings as never,
    flights as never,
    seatHolds as unknown as FlightSeatHoldsService,
    flightResponses as unknown as FlightResponsesService,
    notifications as unknown as NotificationsService,
  );
  return { service, bookings, flights, seatHolds, notifications };
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

describe('FlightBookingConfirmationService.confirmPaid (FLT-23)', () => {
  it('confirms with one conditional update on a live pending hold and gives a reference', async () => {
    const { service, bookings } = setup();

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = bookings.findOneAndUpdate.mock
      .calls[0] as unknown as [
      Record<string, unknown>,
      { $set: { status: string; reference: string } },
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      _id: BOOKING_ID.toString(),
      status: FlightBookingStatus.PendingPayment,
      holdExpiresAt: { $gt: NOW },
    });
    expect(update.$set.status).toBe(FlightBookingStatus.Confirmed);
    expect(update.$set.reference).toMatch(FLIGHT_REFERENCE_PATTERN);
    expect(options).toEqual({ returnDocument: 'after' });
  });

  it('then books the held seats of every segment, outbound and return', async () => {
    const { service, seatHolds } = setup({ updates: [confirmedBooking(true)] });

    await service.confirmPaid(BOOKING_ID.toString(), NOW);

    expect(seatHolds.confirm.mock.calls).toEqual([
      [OUTBOUND_ID, CabinClass.Economy, 2],
      [RETURN_ID, CabinClass.Business, 2],
    ]);
  });

  it('then notifies the owner once, with a link to the booking and the local departure times', async () => {
    const { service, notifications } = setup({
      updates: [confirmedBooking(true)],
    });

    await service.confirmPaid(BOOKING_ID.toString(), NOW);

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      USER_ID,
      NotificationType.BookingConfirmed,
      'Your flight booking FB-7KQ2MX is confirmed. NP123 CAI to JFK, departs 2027-06-15 14:30 CAI time, Economy, 2 seats. Return: NP124 JFK to CAI, departs 2027-06-22 18:05 JFK time, Business, 2 seats. Plus 1 infant on a lap (no seat).',
      { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
    );
  });

  it('is idempotent: a booking confirmed before answers true and nothing changes, no second notification', async () => {
    const { service, seatHolds, notifications } = setup({
      updates: [null],
      found: { reference: 'FB-7KQ2MX', status: FlightBookingStatus.Confirmed },
    });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(seatHolds.confirm).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { status: FlightBookingStatus.Expired }],
    [
      'pending with an ended hold',
      { status: FlightBookingStatus.PendingPayment },
    ],
  ])(
    'answers false for a late payment (%s): not confirmed, nothing booked or sent, no error',
    async (_case, found) => {
      const { service, seatHolds, notifications } = setup({
        updates: [null],
        found,
      });

      await expect(
        service.confirmPaid(BOOKING_ID.toString(), NOW),
      ).resolves.toBe(false);

      expect(seatHolds.confirm).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('answers false and warns for an unknown booking', async () => {
    const { service } = setup({ updates: [null], found: null });

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      false,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers false for an invalid id without reading anything', async () => {
    const { service, bookings } = setup();

    await expect(service.confirmPaid('not-an-id', NOW)).resolves.toBe(false);
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
    const referenceOf = (call: number) =>
      (
        bookings.findOneAndUpdate.mock.calls[call] as unknown as [
          unknown,
          { $set: { reference: string } },
        ]
      )[1].$set.reference;
    expect(referenceOf(1)).toMatch(FLIGHT_REFERENCE_PATTERN);
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

  it('stays confirmed when the notification fails: it is logged with the booking id only', async () => {
    const { service, notifications } = setup();
    notifications.notify.mockRejectedValueOnce(new Error('insert failed'));

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe(
      `Flight booking ${BOOKING_ID.toString()} is confirmed, but its notification was not sent`,
    );
  });

  it('stays confirmed when reading the flights for the message fails', async () => {
    const { service, flights, notifications } = setup();
    flights.find.mockImplementationOnce(() =>
      query(() => Promise.reject(new Error('read failed'))),
    );

    await expect(service.confirmPaid(BOOKING_ID.toString(), NOW)).resolves.toBe(
      true,
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['refuses (the counter disagrees)', () => Promise.resolve(false)],
    ['fails', () => Promise.reject(new Error('write failed'))],
  ])(
    'stays confirmed when moving the seats %s, and logs the booking and the seat count',
    async (_case, outcome) => {
      const { service, seatHolds, notifications } = setup();
      seatHolds.confirm.mockImplementationOnce(outcome);

      await expect(
        service.confirmPaid(BOOKING_ID.toString(), NOW),
      ).resolves.toBe(true);

      expect(
        error.mock.calls.some(([message]) =>
          String(message).includes(
            `Flight booking ${BOOKING_ID.toString()} is confirmed but its 2 economy seat(s)`,
          ),
        ),
      ).toBe(true);
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    },
  );
});
