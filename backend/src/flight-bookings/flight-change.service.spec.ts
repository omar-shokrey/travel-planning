import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import type { AirlinesService } from '../flights/airlines.service';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  type FlightSeatHoldsService,
} from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../notifications/notifications.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import type { ChangeFlightDto } from './dto/change-flight.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightChangeStatus } from './enums/flight-change-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import {
  CHANGE_AGE_GROUP_MESSAGE,
  CHANGE_BAGS_MESSAGE,
  CHANGE_BOOKING_CHANGED_MESSAGE,
  CHANGE_DEPARTED_MESSAGE,
  CHANGE_DIFFERENCE_CHANGED_MESSAGE,
  CHANGE_IN_PROGRESS_MESSAGE,
  CHANGE_NOT_CONFIRMED_MESSAGE,
  CHANGE_REFUND_TOO_LARGE_MESSAGE,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  FLIGHT_CHANGE_STUCK_AFTER_MS,
  OUTBOUND_AFTER_RETURN_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  SAME_FLIGHT_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
  changeRouteMessage,
} from './flight-bookings.constants';
import { FlightChangeService } from './flight-change.service';
import type { FlightSeatsService } from './flight-seats.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const USER = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const STRANGER = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const AIRLINE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90b01');
const OTHER_AIRLINE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90b02');
const FROM = new Types.ObjectId('6740f1c2a4b5c6d7e8f90f01');
const TO = new Types.ObjectId('6740f1c2a4b5c6d7e8f90f02');
const BACK = new Types.ObjectId('6740f1c2a4b5c6d7e8f90f03');
const FARE = 10_000;

type Doc = Record<string, unknown>;

/** The value at a dotted path (`segments.0.flightId`). */
const at = (doc: Doc, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value === undefined || value === null ? undefined : (value as Doc)[key],
      doc,
    );

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date
    ? a.getTime() === b.getTime()
    : String(a) === String(b);

/** The few MongoDB filters the service uses. */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([path, wanted]) => {
    const value = at(doc, path);
    if (
      wanted !== null &&
      typeof wanted === 'object' &&
      !(wanted instanceof Date) &&
      !(wanted instanceof Types.ObjectId)
    ) {
      const op = wanted as Doc;
      if ('$exists' in op) return (value !== undefined) === op.$exists;
      if ('$gt' in op)
        return value !== undefined && (value as number) > (op.$gt as number);
      if ('$lte' in op)
        return value !== undefined && (value as number) <= (op.$lte as number);
      if ('$in' in op) return (op.$in as unknown[]).some((v) => same(v, value));
      throw new Error(`Unsupported filter ${JSON.stringify(op)}`);
    }
    return same(value, wanted);
  });
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const parent = keys.reduce<Doc>((current, key) => current[key] as Doc, doc);
  parent[last] = value;
}

type Update = { $set?: Doc; $unset?: Doc; $addToSet?: Doc };

const applyUpdate = (doc: Doc, update: Update): void => {
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    setPath(doc, path, value);
  }
  for (const path of Object.keys(update.$unset ?? {})) {
    delete doc[path];
  }
  for (const [path, value] of Object.entries(update.$addToSet ?? {})) {
    const list = (doc[path] as unknown[] | undefined) ?? [];
    if (!list.includes(value)) doc[path] = [...list, value];
  }
  doc.updatedAt = NOW;
};

/** A chain `.select().sort().limit().lean().orFail().exec()` that resolves to `value`. */
const query = (value: unknown) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    lean: () => chain,
    orFail: () => {
      if (value === null || value === undefined) throw new Error('not found');
      return chain;
    },
    exec: () => Promise.resolve(value),
  };
  return chain;
};

const clone = <T>(value: T): T => structuredCloneDocs(value);
/** A copy that keeps ObjectIds and Dates (structuredClone turns ObjectIds into objects). */
function structuredCloneDocs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(structuredCloneDocs) as T;
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Types.ObjectId) &&
    !(value instanceof Date)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, structuredCloneDocs(v)]),
    ) as T;
  }
  return value;
}

/** A tiny collection: find, findOne, findById, countDocuments, create, updateOne, findOneAndUpdate. */
function collection(
  initial: Doc[] = [],
  options: { uniqueOpenBooking?: boolean } = {},
) {
  const docs: Doc[] = initial.map(clone);
  const one = (filter: Doc) => docs.find((doc) => matches(doc, filter)) ?? null;
  return {
    docs,
    find: jest.fn((filter: Doc = {}) =>
      query(docs.filter((doc) => matches(doc, filter)).map(clone)),
    ),
    findOne: jest.fn((filter: Doc) => {
      const found = one(filter);
      return query(found && clone(found));
    }),
    findById: jest.fn((id: unknown) => {
      const found = one({ _id: id });
      return query(found && clone(found));
    }),
    create: jest.fn((doc: Doc) => {
      if (
        options.uniqueOpenBooking &&
        doc.open === true &&
        docs.some((d) => d.open === true && same(d.bookingId, doc.bookingId))
      ) {
        return Promise.reject(
          Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
        );
      }
      const saved = {
        _id: new Types.ObjectId(),
        createdAt: NOW,
        updatedAt: NOW,
        ...clone(doc),
      };
      docs.push(saved);
      return Promise.resolve({ toObject: () => clone(saved) });
    }),
    updateOne: jest.fn((filter: Doc, update: Update) => {
      const found = one(filter);
      if (found) applyUpdate(found, update);
      return { exec: () => Promise.resolve({ matchedCount: found ? 1 : 0 }) };
    }),
    countDocuments: jest.fn((filter: Doc) => ({
      exec: () =>
        Promise.resolve(docs.filter((doc) => matches(doc, filter)).length),
    })),
    findOneAndUpdate: jest.fn((filter: Doc, update: Update) => {
      const found = one(filter);
      if (found) applyUpdate(found, update);
      return query(found && clone(found));
    }),
  };
}

const flight = (fields: Doc = {}): Doc => ({
  _id: FROM,
  airlineId: AIRLINE,
  flightNumber: 'NP100',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date(NOW.getTime() + 30 * DAY_MS),
  arrivalAt: new Date(NOW.getTime() + 30 * DAY_MS + 12 * 3_600_000),
  departureDateLocal: '2026-12-20',
  status: FlightStatus.Scheduled,
  cabins: [
    {
      cabin: CabinClass.Economy,
      price: FARE,
      totalSeats: 100,
      bookedSeats: 10,
      heldSeats: 0,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

const toFlight = (price: number, fields: Doc = {}): Doc =>
  flight({
    _id: TO,
    airlineId: OTHER_AIRLINE,
    flightNumber: 'NP200',
    departureAt: new Date(NOW.getTime() + 31 * DAY_MS),
    arrivalAt: new Date(NOW.getTime() + 31 * DAY_MS + 12 * 3_600_000),
    departureDateLocal: '2026-12-21',
    cabins: [
      {
        cabin: CabinClass.Economy,
        price,
        totalSeats: 100,
        bookedSeats: 0,
        heldSeats: 0,
        freeBags: 2,
        maxBagKg: 23,
      },
    ],
    ...fields,
  });

const segment = (fields: Doc = {}): Doc => ({
  flightId: FROM,
  airlineId: AIRLINE,
  cabin: CabinClass.Economy,
  fare: FARE,
  seatsReserved: 1,
  cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  extraBagPrice: 4000,
  maxExtraBags: 2,
  freeBags: 1,
  maxBagKg: 23,
  ...fields,
});

/** One adult with one extra bag (4000) and one infant: 10000 + 1000 + 4000. */
const booking = (fields: Doc = {}): Doc => ({
  _id: BOOKING,
  userId: USER,
  reference: 'FB-7KQ2MX',
  status: FlightBookingStatus.Confirmed,
  currency: 'USD',
  fareTotal: 11_000,
  baggageTotal: 4000,
  total: 15_000,
  segments: [segment()],
  passengerCounts: { adults: 1, children: 0, infants: 1 },
  passengers: [
    {
      fullName: 'Test Adult',
      dateOfBirth: '1990-01-01',
      passportNumber: 'A1234567',
      type: PassengerType.Adult,
      baggage: [{ segment: 0, bags: 1, weightKg: 20 }],
    },
    {
      fullName: 'Test Infant',
      dateOfBirth: '2026-03-01',
      passportNumber: 'B1234567',
      type: PassengerType.Infant,
      baggage: [],
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

const airlineWith = (extraBagPrice: number | undefined, maxExtraBags = 2) => ({
  _id: OTHER_AIRLINE,
  name: 'Other Air',
  active: true,
  policy: {
    cancellationTiers: [{ daysBefore: 30, refundPercent: 80 }],
    extraBagPrice,
    maxExtraBags,
  },
});

function setup(
  options: {
    booking?: Doc | null;
    flights?: Doc[];
    airline?: Doc;
    changes?: Doc[];
  } = {},
) {
  const bookings = collection(
    options.booking === null ? [] : [options.booking ?? booking()],
  );
  const flights = collection(options.flights ?? [flight(), toFlight(12_000)]);
  const changes = collection(options.changes ?? [], {
    uniqueOpenBooking: true,
  });
  const airlines = {
    findEntityOrThrow: jest.fn(() =>
      Promise.resolve(options.airline ?? airlineWith(5000)),
    ),
  };
  const seatHolds = {
    hold: jest.fn((id: unknown) => {
      const held = flights.docs.find((f) => same(f._id, id));
      return Promise.resolve(clone(held));
    }),
    release: jest.fn(() => Promise.resolve(true)),
    confirm: jest.fn(() => Promise.resolve(true)),
    unbook: jest.fn(() => Promise.resolve(true)),
  };
  const flightResponses = {
    toResponses: jest.fn((list: Doc[]) =>
      Promise.resolve(list.map((f) => ({ id: String(f._id) }))),
    ),
    timeZonesOf: jest.fn(() =>
      Promise.resolve(new Map([['CAI', 'Africa/Cairo']])),
    ),
  };
  const refundSummary = {
    id: 'refund-1',
    status: 'pending',
    amount: 1,
    currency: 'USD',
    refundPercent: 1,
  };
  const refunds = {
    refundAmount: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    refund: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    findSummaryByBooking: jest.fn((..._args: unknown[]) =>
      Promise.resolve(refundSummary),
    ),
  };
  const seats = { releaseSegment: jest.fn(() => Promise.resolve(1)) };
  const notifications = { notify: jest.fn(() => Promise.resolve()) };
  const service = new FlightChangeService(
    changes as never,
    bookings as never,
    flights as never,
    airlines as unknown as AirlinesService,
    seatHolds as unknown as FlightSeatHoldsService,
    flightResponses as unknown as FlightResponsesService,
    refunds as unknown as RefundsService,
    seats as unknown as FlightSeatsService,
    notifications as unknown as NotificationsService,
  );
  return {
    service,
    bookings,
    flights,
    changes,
    airlines,
    seatHolds,
    refunds,
    seats,
    notifications,
    refundSummary,
  };
}

const quote = (fields: Partial<ChangeFlightDto> = {}): ChangeFlightDto => ({
  newFlightId: TO.toString(),
  dryRun: true,
  ...fields,
});
const change = (
  expectedDifference: number,
  fields: Partial<ChangeFlightDto> = {},
) =>
  ({
    newFlightId: TO.toString(),
    expectedDifference,
    policiesAccepted: true,
    ...fields,
  }) as ChangeFlightDto;

async function failureOf(call: Promise<unknown>): Promise<Error> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error('the call did not fail');
  return error;
}

const fieldErrorsOf = (error: Error): FieldError[] =>
  ((error as BadRequestException).getResponse() as { errors: FieldError[] })
    .errors;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('FlightChangeService: the quote (dry run, FLT-27)', () => {
  it('prices the segment before and after, with the new airline bag price, and changes nothing', async () => {
    const s = setup();

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      quote(),
      NOW,
    );

    // Before: 10000 + 1000 + 1 bag × 4000. After: 12000 + 1200 + 1 bag × 5000.
    expect(answer).toMatchObject({
      id: null,
      status: 'quote',
      bookingId: BOOKING.toString(),
      segmentIndex: 0,
      cabin: CabinClass.Economy,
      fromFlight: { id: FROM.toString() },
      toFlight: { id: TO.toString() },
      oldSegmentTotal: 15_000,
      newSegmentTotal: 18_200,
      difference: 3200,
      newTotal: 18_200,
      currency: 'USD',
      holdExpiresAt: null,
      payment: null,
      refund: null,
      newPolicies: {
        flightId: TO.toString(),
        cancellationTiers: [{ daysBefore: 30, refundPercent: 80 }],
        baggage: { freeBags: 2, extraBagPrice: 5000, maxExtraBags: 2 },
      },
    });
    expect(s.changes.create).not.toHaveBeenCalled();
    expect(s.seatHolds.hold).not.toHaveBeenCalled();
    expect(s.bookings.updateOne).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing booking or another user's, with the owner in the filter", async () => {
    const s = setup();

    const error = await failureOf(
      s.service.change(BOOKING.toString(), STRANGER.toString(), quote(), NOW),
    );

    expect(error).toEqual(new NotFoundException('Booking not found'));
    expect(s.bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING.toString(),
      userId: STRANGER,
    });
  });

  it.each([
    FlightBookingStatus.PendingPayment,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Cancelled,
    FlightBookingStatus.Completed,
  ])('answers 409 for a %s booking', async (status) => {
    const s = setup({ booking: booking({ status }) });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_NOT_CONFIRMED_MESSAGE));
  });

  it('answers 400 for a round trip without segmentIndex, and for the flight already booked', async () => {
    const s = setup({
      booking: booking({
        segments: [segment(), segment({ flightId: BACK })],
      }),
    });

    const noSegment = await failureOf(
      s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    );
    const sameFlight = await failureOf(
      setup().service.change(
        BOOKING.toString(),
        USER.toString(),
        quote({ newFlightId: FROM.toString() }),
        NOW,
      ),
    );

    expect(fieldErrorsOf(noSegment)).toEqual([
      { field: 'segmentIndex', messages: [SEGMENT_INDEX_REQUIRED_MESSAGE] },
    ]);
    expect(fieldErrorsOf(sameFlight)).toEqual([
      { field: 'newFlightId', messages: [SAME_FLIGHT_MESSAGE] },
    ]);
  });

  it('answers 409 when the booked flight has departed or no longer exists, and when its airline cancelled it', async () => {
    const departed = setup({
      flights: [flight({ departureAt: NOW }), toFlight(12_000)],
    });
    const gone = setup({ flights: [toFlight(12_000)] });
    const cancelled = setup({
      flights: [flight({ status: FlightStatus.Cancelled }), toFlight(12_000)],
    });

    for (const s of [departed, gone]) {
      await expect(
        s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
      ).rejects.toThrow(new ConflictException(CHANGE_DEPARTED_MESSAGE));
    }
    await expect(
      cancelled.service.change(
        BOOKING.toString(),
        USER.toString(),
        quote(),
        NOW,
      ),
    ).rejects.toThrow(
      new ConflictException(FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE),
    );
  });

  it('reads the new flight as a booking does: 409 when it can no longer be booked, 404 when missing', async () => {
    const notBookable = setup({
      flights: [flight(), toFlight(12_000, { status: FlightStatus.Cancelled })],
    });
    const missing = setup({ flights: [flight()] });

    await expect(
      notBookable.service.change(
        BOOKING.toString(),
        USER.toString(),
        quote(),
        NOW,
      ),
    ).rejects.toThrow(new ConflictException(FLIGHT_NOT_BOOKABLE_MESSAGE));
    await expect(
      missing.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 400 for another route', async () => {
    const s = setup({
      flights: [flight(), toFlight(12_000, { arrivalAirport: 'LHR' })],
    });

    const error = await failureOf(
      s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    );

    expect(fieldErrorsOf(error)).toEqual([
      { field: 'newFlightId', messages: [changeRouteMessage('CAI', 'JFK')] },
    ]);
  });

  it('keeps a round trip in order: the new outbound arrives before the return leaves, the new return leaves after the outbound arrives', async () => {
    const back = flight({
      _id: BACK,
      departureAirport: 'JFK',
      arrivalAirport: 'CAI',
      departureAt: new Date(NOW.getTime() + 31 * DAY_MS),
      arrivalAt: new Date(NOW.getTime() + 31 * DAY_MS + 12 * 3_600_000),
    });
    const roundTrip = booking({
      segments: [segment(), segment({ flightId: BACK })],
    });
    // The new outbound leaves after the return.
    const lateOutbound = setup({
      booking: roundTrip,
      flights: [
        flight(),
        back,
        toFlight(12_000, {
          departureAt: new Date(NOW.getTime() + 32 * DAY_MS),
          arrivalAt: new Date(NOW.getTime() + 32 * DAY_MS + 3_600_000),
        }),
      ],
    });
    // The new return leaves before the outbound arrives.
    const earlyReturn = setup({
      booking: roundTrip,
      flights: [
        flight(),
        back,
        toFlight(12_000, {
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureAt: new Date(NOW.getTime() + 30 * DAY_MS + 3_600_000),
        }),
      ],
    });

    const outbound = await failureOf(
      lateOutbound.service.change(
        BOOKING.toString(),
        USER.toString(),
        quote({ segmentIndex: 0 }),
        NOW,
      ),
    );
    const returning = await failureOf(
      earlyReturn.service.change(
        BOOKING.toString(),
        USER.toString(),
        quote({ segmentIndex: 1 }),
        NOW,
      ),
    );

    expect(fieldErrorsOf(outbound)).toEqual([
      { field: 'newFlightId', messages: [OUTBOUND_AFTER_RETURN_MESSAGE] },
    ]);
    expect(fieldErrorsOf(returning)).toEqual([
      { field: 'newFlightId', messages: [RETURN_TOO_EARLY_MESSAGE] },
    ]);
  });

  it('answers 409 when a passenger would change age group on the new date', async () => {
    // The infant turns 2 on 2028-03-01.
    const s = setup({
      flights: [
        flight(),
        toFlight(12_000, { departureDateLocal: '2028-03-01' }),
      ],
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_AGE_GROUP_MESSAGE));
  });

  it('answers 409 when the extra bags are not allowed by the new airline', async () => {
    const s = setup({ airline: airlineWith(undefined, 0) });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), quote(), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_BAGS_MESSAGE));
  });
});

describe('FlightChangeService: making the change (FLT-27)', () => {
  it('refuses a difference other than the one shown, before anything is written', async () => {
    const s = setup();

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(3199), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_DIFFERENCE_CHANGED_MESSAGE));
    expect(s.changes.create).not.toHaveBeenCalled();
    expect(s.seatHolds.hold).not.toHaveBeenCalled();
  });

  it('holds a dearer flight for 10 minutes and waits for the payment, without touching the booking', async () => {
    const s = setup();

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );

    const holdEnd = new Date(NOW.getTime() + 10 * 60 * 1000);
    expect(s.seatHolds.hold).toHaveBeenCalledWith(
      TO,
      CabinClass.Economy,
      1,
      NOW,
    );
    expect(s.changes.docs[0]).toMatchObject({
      bookingId: BOOKING,
      userId: USER,
      status: FlightChangeStatus.PendingPayment,
      open: true,
      difference: 3200,
      totalBefore: 15_000,
      newTotal: 18_200,
      newFareTotal: 13_200,
      newBaggageTotal: 5000,
      holdExpiresAt: holdEnd,
      policyAcceptedAt: NOW,
    });
    expect(answer).toMatchObject({
      status: 'pending_payment',
      holdExpiresAt: holdEnd.toISOString(),
      payment: {
        bookingType: 'flight_change',
        bookingId: String(s.changes.docs[0]._id),
      },
    });
    expect(s.bookings.updateOne).not.toHaveBeenCalled();
    expect(s.seatHolds.confirm).not.toHaveBeenCalled();
  });

  it('changes an equal flight at once: new seats booked, the segment swapped, old seats and chosen seats given back, owner notified', async () => {
    const s = setup({
      flights: [flight(), toFlight(FARE)],
      airline: airlineWith(4000),
    });

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(0),
      NOW,
    );

    expect(answer).toMatchObject({
      status: 'completed',
      difference: 0,
      refund: null,
    });
    expect(s.seatHolds.confirm).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
    expect(s.bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: BOOKING,
        status: FlightBookingStatus.Confirmed,
        'segments.0.flightId': FROM,
        total: 15_000,
      },
      {
        $set: expect.objectContaining({
          'segments.0': expect.objectContaining({
            flightId: TO,
            airlineId: OTHER_AIRLINE,
            fare: FARE,
            cancellationTiers: [{ daysBefore: 30, refundPercent: 80 }],
          }),
          total: 15_000,
        }),
      },
    );
    expect(s.seatHolds.unbook).toHaveBeenCalledWith(
      FROM,
      CabinClass.Economy,
      1,
    );
    expect(s.seats.releaseSegment).toHaveBeenCalledWith(BOOKING, 0);
    expect(s.refunds.refundAmount).not.toHaveBeenCalled();
    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Completed,
      open: false,
      completedAt: NOW,
    });
    expect(s.notifications.notify).toHaveBeenCalledWith(
      USER,
      NotificationType.FlightChanged,
      expect.stringContaining('Your flight booking FB-7KQ2MX was changed.'),
      { type: 'flight_booking', id: BOOKING },
    );
    // The seats are booked before the swap, and the old ones given back after it.
    expect(s.seatHolds.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      s.bookings.updateOne.mock.invocationCallOrder[0],
    );
    expect(s.bookings.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      s.seatHolds.unbook.mock.invocationCallOrder[0],
    );
  });

  it('refunds a cheaper flight the exact difference from the booking payment, keyed on the change', async () => {
    const s = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );

    const changeId = String(s.changes.docs[0]._id);
    expect(s.refunds.refundAmount).toHaveBeenCalledWith({
      bookingType: BookingType.FlightChange,
      bookingId: changeId,
      paymentOf: {
        bookingType: BookingType.Flight,
        bookingId: BOOKING.toString(),
      },
      amount: 2200,
      reason: RefundReason.FareDifference,
      link: { bookingType: BookingType.Flight, bookingId: BOOKING.toString() },
    });
    expect(answer).toMatchObject({
      status: 'completed',
      difference: -2200,
      refund: s.refundSummary,
    });
    expect(s.refunds.findSummaryByBooking).toHaveBeenCalledWith(
      BookingType.FlightChange,
      changeId,
    );
  });

  it('refuses a cheaper flight whose refund is more than the original payment still holds', async () => {
    // The booking paid 15000, then 14000 more for a dearer change: the
    // original payment holds 15000 - 14000 = 1000, less than the 2200 back.
    const s = setup({
      booking: booking({ total: 15_000 }),
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
      changes: [
        {
          _id: new Types.ObjectId(),
          bookingId: BOOKING,
          status: FlightChangeStatus.Completed,
          difference: 14_000,
          open: false,
        },
      ],
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(-2200), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_REFUND_TOO_LARGE_MESSAGE));
    expect(s.seatHolds.hold).not.toHaveBeenCalled();
  });

  it('answers 409 while another change of the booking is open, and holds nothing', async () => {
    const s = setup({
      changes: [
        {
          _id: new Types.ObjectId(),
          bookingId: BOOKING,
          status: FlightChangeStatus.PendingPayment,
          open: true,
        },
      ],
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(3200), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_IN_PROGRESS_MESSAGE));
    expect(s.seatHolds.hold).not.toHaveBeenCalled();
  });

  it("closes the change when the hold is refused, and passes the hold's answer on", async () => {
    const s = setup();
    s.seatHolds.hold.mockRejectedValueOnce(
      new ConflictException('Not enough seats left in this cabin'),
    );

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(3200), NOW),
    ).rejects.toThrow('Not enough seats left in this cabin');
    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
    });
    expect(s.seatHolds.release).not.toHaveBeenCalled();
  });

  it('gives the seats back and answers 409 when the price moved between the quote and the hold', async () => {
    const s = setup();
    s.seatHolds.hold.mockImplementationOnce(() =>
      Promise.resolve(clone(toFlight(12_500))),
    );

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(3200), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_DIFFERENCE_CHANGED_MESSAGE));
    expect(s.seatHolds.release).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
    });
  });

  it('abandons the change when the booking was cancelled before the swap: the new seats go back and nothing else moves', async () => {
    const s = setup({
      flights: [flight(), toFlight(FARE)],
      airline: airlineWith(4000),
    });
    // The user cancels (FLT-26) between the hold and the swap.
    s.seatHolds.confirm.mockImplementationOnce(() => {
      s.bookings.docs[0].status = FlightBookingStatus.Cancelled;
      return Promise.resolve(true);
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(0), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_BOOKING_CHANGED_MESSAGE));
    expect(s.seatHolds.unbook).toHaveBeenCalledTimes(1);
    expect(s.seatHolds.unbook).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
    expect(s.seats.releaseSegment).not.toHaveBeenCalled();
    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
    });
    expect(s.notifications.notify).not.toHaveBeenCalled();
  });

  it('stays applying when the refund cannot be made yet, and the job finishes it without repeating a seat step', async () => {
    const s = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });
    s.refunds.refundAmount.mockRejectedValueOnce(new Error('database down'));

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );
    expect(answer.status).toBe('applying');

    const later = new Date(NOW.getTime() + FLIGHT_CHANGE_STUCK_AFTER_MS);
    await expect(s.service.finishStuck(later)).resolves.toBe(1);

    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Completed,
    });
    expect(s.refunds.refundAmount).toHaveBeenCalledTimes(2);
    expect(s.seatHolds.confirm).toHaveBeenCalledTimes(1);
    expect(s.seatHolds.unbook).toHaveBeenCalledTimes(1);
    expect(s.seats.releaseSegment).toHaveBeenCalledTimes(1);
    expect(s.notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('completes anyway, and logs it for the team, when the refund is more than the payment holds', async () => {
    const s = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });
    s.refunds.refundAmount.mockRejectedValueOnce(
      new ConflictException(
        'The refund is larger than what is left of the payment',
      ),
    );

    const answer = await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );

    expect(answer.status).toBe('completed');
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('check it by hand'),
      expect.anything(),
    );
  });

  it('changes the return flight of a round trip and frees the chosen seats of that segment only', async () => {
    const back = flight({
      _id: BACK,
      departureAirport: 'JFK',
      arrivalAirport: 'CAI',
      departureAt: new Date(NOW.getTime() + 35 * DAY_MS),
      arrivalAt: new Date(NOW.getTime() + 35 * DAY_MS + 12 * 3_600_000),
    });
    const s = setup({
      booking: booking({
        segments: [segment(), segment({ flightId: BACK, extraBagPrice: 4000 })],
        fareTotal: 22_000,
        total: 26_000,
      }),
      flights: [
        flight(),
        back,
        toFlight(FARE, {
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureAt: new Date(NOW.getTime() + 36 * DAY_MS),
        }),
      ],
      airline: airlineWith(4000),
    });

    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(0, { segmentIndex: 1 }),
      NOW,
    );

    expect(s.bookings.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'segments.1.flightId': BACK }),
      expect.anything(),
    );
    expect(s.seatHolds.unbook).toHaveBeenCalledWith(
      BACK,
      CabinClass.Economy,
      1,
    );
    expect(s.seats.releaseSegment).toHaveBeenCalledWith(BOOKING, 1);
  });
});

describe('FlightChangeService.confirmPaid (FLT-27, PAY-01)', () => {
  async function pendingChange() {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    return { s, id: String(s.changes.docs[0]._id) };
  }

  it('applies a paid change while its hold is live, once even if the webhook repeats', async () => {
    const { s, id } = await pendingChange();

    await expect(s.service.confirmPaid(id, NOW)).resolves.toBe(true);
    await expect(s.service.confirmPaid(id, NOW)).resolves.toBe(true);

    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Completed,
      paidAt: NOW,
    });
    expect(s.bookings.docs[0]).toMatchObject({ total: 18_200 });
    expect(s.seatHolds.confirm).toHaveBeenCalledTimes(1);
    expect(s.seatHolds.unbook).toHaveBeenCalledTimes(1);
    expect(s.notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('answers false for a payment after the hold ended: nothing changes and the webhook refunds it', async () => {
    const { s, id } = await pendingChange();
    const late = new Date(NOW.getTime() + 10 * 60 * 1000);

    await expect(s.service.confirmPaid(id, late)).resolves.toBe(false);

    expect(s.changes.docs[0].status).toBe(FlightChangeStatus.PendingPayment);
    expect(s.bookings.updateOne).not.toHaveBeenCalled();
  });

  it('answers false when the booking was cancelled before the payment arrived, and gives the new seats back', async () => {
    const { s, id } = await pendingChange();
    s.bookings.docs[0].status = FlightBookingStatus.Cancelled;

    await expect(s.service.confirmPaid(id, NOW)).resolves.toBe(false);

    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
    });
    expect(s.seatHolds.unbook).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
  });

  it('answers false for an unknown change or an id that is not an id', async () => {
    const s = setup();

    await expect(
      s.service.confirmPaid(new Types.ObjectId().toString(), NOW),
    ).resolves.toBe(false);
    await expect(s.service.confirmPaid('abc', NOW)).resolves.toBe(false);
  });
});

describe('FlightChangeService: the change job and the cancellations (FLT-27)', () => {
  it('expires a dearer change whose hold ended unpaid and gives its held seats back', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );

    await expect(s.service.expireDueHolds(NOW)).resolves.toBe(0);
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    await expect(s.service.expireDueHolds(later)).resolves.toBe(1);
    await expect(s.service.expireDueHolds(later)).resolves.toBe(0);

    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
      expiredAt: later,
    });
    expect(s.seatHolds.release).toHaveBeenCalledTimes(1);
    expect(s.seatHolds.release).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
  });

  it('refunds a paid change in full when the job finds it abandoned', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    Object.assign(s.changes.docs[0], {
      status: FlightChangeStatus.Applying,
      paidAt: NOW,
    });
    s.bookings.docs[0].status = FlightBookingStatus.Cancelled;

    await s.service.finishStuck(
      new Date(NOW.getTime() + FLIGHT_CHANGE_STUCK_AFTER_MS),
    );

    expect(s.refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.FlightChange,
      bookingId: String(s.changes.docs[0]._id),
      refundPercent: 100,
      reason: RefundReason.LatePayment,
    });
  });

  it('leaves a change applying for less than the stuck time to its own request', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    s.changes.docs[0].status = FlightChangeStatus.Applying;

    await expect(
      s.service.finishStuck(new Date(NOW.getTime() + 1000)),
    ).resolves.toBe(0);
  });

  it('closes the open change of a cancelled booking (FLT-26) and the changes waiting to a cancelled flight (FLT-06)', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );

    await s.service.closeOpenChangeOf(BOOKING, NOW);
    expect(s.changes.docs[0].status).toBe(FlightChangeStatus.Expired);
    expect(s.seatHolds.release).toHaveBeenCalledTimes(1);

    const t = setup();
    await t.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    await expect(t.service.closePendingChangesTo(TO, NOW)).resolves.toBe(1);
    await expect(t.service.closePendingChangesTo(TO, NOW)).resolves.toBe(0);
    expect(t.seatHolds.release).toHaveBeenCalledTimes(1);
  });

  it('lists the paid differences of the completed dearer changes only', async () => {
    const paid = new Types.ObjectId();
    const s = setup({
      changes: [
        {
          _id: paid,
          bookingId: BOOKING,
          status: FlightChangeStatus.Completed,
          difference: 3200,
        },
        {
          _id: new Types.ObjectId(),
          bookingId: BOOKING,
          status: FlightChangeStatus.Completed,
          difference: -500,
        },
        {
          _id: new Types.ObjectId(),
          bookingId: BOOKING,
          status: FlightChangeStatus.Expired,
          difference: 900,
        },
        {
          _id: new Types.ObjectId(),
          bookingId: BOOKING,
          status: FlightChangeStatus.PendingPayment,
          difference: 700,
        },
      ],
    });

    await expect(s.service.paidDifferencesOf(BOOKING)).resolves.toEqual([
      { id: paid.toString(), difference: 3200 },
    ]);
    expect(s.changes.find).toHaveBeenCalledWith({
      bookingId: BOOKING,
      status: FlightChangeStatus.Completed,
      difference: { $gt: 0 },
    });
  });

  it('shows the refund of a cheaper change in the summaries, and finds the owner and booking of a change', async () => {
    const s = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );
    const id = String(s.changes.docs[0]._id);

    const [summary] = await s.service.summariesOf(BOOKING);
    const many = await s.service.summariesOfMany([BOOKING]);

    expect(summary).toMatchObject({
      id,
      difference: -2200,
      refund: s.refundSummary,
    });
    expect(many.get(BOOKING.toString())?.[0]).toMatchObject({
      id,
      refund: null,
    });
    await expect(
      s.service.findOwned(id, USER.toString()),
    ).resolves.toMatchObject({
      bookingId: BOOKING,
    });
    await expect(
      s.service.findOwned(id, STRANGER.toString()),
    ).resolves.toBeNull();
    await expect(
      s.service.findOwned('abc', USER.toString()),
    ).resolves.toBeNull();
    await expect(s.service.bookingOf(id)).resolves.toEqual(BOOKING);
    await expect(s.service.bookingOf('abc')).resolves.toBeNull();
  });
});

describe('FlightChangeService: a booking cancelled while a paid change completes (FLT-27)', () => {
  it("refunds the change's payment at the booking's percent, with the cancellation's reason", async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    const id = String(s.changes.docs[0]._id);
    // The swap happens, then the user cancels before the change completes.
    s.seatHolds.unbook.mockImplementationOnce(() => {
      Object.assign(s.bookings.docs[0], {
        status: FlightBookingStatus.Cancelled,
        refundPercent: 50,
        cancelledBy: 'user',
      });
      return Promise.resolve(true);
    });

    await expect(s.service.confirmPaid(id, NOW)).resolves.toBe(true);

    expect(s.refunds.refund).toHaveBeenCalledWith({
      bookingType: BookingType.FlightChange,
      bookingId: id,
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
    });
  });

  it('refunds nothing more for a booking still confirmed, a cheaper change, or a 0% cancellation', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    await s.service.confirmPaid(String(s.changes.docs[0]._id), NOW);

    const t = setup();
    await t.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    t.seatHolds.unbook.mockImplementationOnce(() => {
      Object.assign(t.bookings.docs[0], {
        status: FlightBookingStatus.Cancelled,
        refundPercent: 0,
      });
      return Promise.resolve(true);
    });
    await t.service.confirmPaid(String(t.changes.docs[0]._id), NOW);

    expect(s.refunds.refund).not.toHaveBeenCalled();
    expect(t.refunds.refund).not.toHaveBeenCalled();
  });
});

describe('FlightChangeService: the review cases (FLT-27)', () => {
  const later = new Date(NOW.getTime() + FLIGHT_CHANGE_STUCK_AFTER_MS);

  it('never releases or books seats for a change that crashed before its hold', async () => {
    const pending = new Types.ObjectId();
    const applying = new Types.ObjectId();
    const base = {
      bookingId: BOOKING,
      userId: USER,
      segmentIndex: 0,
      cabin: CabinClass.Economy,
      seats: 1,
      fromFlightId: FROM,
      toFlightId: TO,
      difference: 0,
      totalBefore: 15_000,
      open: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const s = setup({
      changes: [
        {
          ...base,
          _id: pending,
          status: FlightChangeStatus.PendingPayment,
          holdExpiresAt: NOW,
        },
        {
          ...base,
          _id: applying,
          bookingId: new Types.ObjectId(),
          status: FlightChangeStatus.Applying,
        },
      ],
    });

    await expect(s.service.expireDueHolds(NOW)).resolves.toBe(1);
    await expect(s.service.finishStuck(later)).resolves.toBe(1);

    expect(s.changes.docs.map((c) => c.status)).toEqual([
      FlightChangeStatus.Expired,
      FlightChangeStatus.Expired,
    ]);
    expect(s.seatHolds.release).not.toHaveBeenCalled();
    expect(s.seatHolds.confirm).not.toHaveBeenCalled();
    expect(s.seatHolds.unbook).not.toHaveBeenCalled();
  });

  it('abandons a paid change whose new flight the airline cancelled, giving the held seats back: confirmPaid answers false, so the webhook refunds it', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    const id = String(s.changes.docs[0]._id);
    s.flights.docs[1].status = FlightStatus.Cancelled;

    await expect(s.service.confirmPaid(id, NOW)).resolves.toBe(false);

    expect(s.changes.docs[0].status).toBe(FlightChangeStatus.Expired);
    expect(s.seatHolds.confirm).not.toHaveBeenCalled();
    expect(s.seatHolds.release).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
    expect(s.bookings.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ['booking the new seats', 'confirm'],
    ['giving the old seats back', 'unbook'],
  ] as const)(
    'stays applying when %s fails, and the job does that step again once',
    async (_name, method) => {
      const s = setup({
        flights: [flight(), toFlight(FARE)],
        airline: airlineWith(4000),
      });
      s.seatHolds[method].mockRejectedValueOnce(new Error('database down'));

      const answer = await s.service.change(
        BOOKING.toString(),
        USER.toString(),
        change(0),
        NOW,
      );
      expect(answer.status).toBe('applying');

      await expect(s.service.finishStuck(later)).resolves.toBe(1);

      expect(s.changes.docs[0].status).toBe(FlightChangeStatus.Completed);
      expect(s.seatHolds[method]).toHaveBeenCalledTimes(2);
      expect(s.seatHolds.confirm.mock.calls.length).toBeLessThanOrEqual(2);
      expect(s.seats.releaseSegment).toHaveBeenCalledTimes(1);
      expect(s.notifications.notify).toHaveBeenCalledTimes(1);
    },
  );

  it('stays applying when freeing the chosen seats fails, and the job frees them without giving the old seats back twice', async () => {
    const s = setup({
      flights: [flight(), toFlight(FARE)],
      airline: airlineWith(4000),
    });
    s.seats.releaseSegment.mockRejectedValueOnce(new Error('database down'));

    await s.service.change(BOOKING.toString(), USER.toString(), change(0), NOW);
    await s.service.finishStuck(later);

    expect(s.changes.docs[0].status).toBe(FlightChangeStatus.Completed);
    expect(s.seats.releaseSegment).toHaveBeenCalledTimes(2);
    expect(s.seatHolds.unbook).toHaveBeenCalledTimes(1);
  });

  it('tries the refund again when another refund of the payment was being made, but gives up on a missing payment', async () => {
    const busy = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });
    busy.refunds.refundAmount.mockRejectedValueOnce(
      new ConflictException(
        'The payment is being refunded by another request. Try again.',
      ),
    );
    const missing = setup({
      flights: [flight(), toFlight(8000)],
      airline: airlineWith(4000),
    });
    missing.refunds.refundAmount.mockRejectedValueOnce(
      new NotFoundException('Payment not found'),
    );

    const first = await busy.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );
    const second = await missing.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(-2200),
      NOW,
    );

    expect(first.status).toBe('applying');
    expect(second.status).toBe('completed');

    // The job makes the busy refund on its next run.
    await expect(busy.service.finishStuck(later)).resolves.toBe(1);
    expect(busy.refunds.refundAmount).toHaveBeenCalledTimes(2);
    expect(busy.changes.docs[0].status).toBe(FlightChangeStatus.Completed);
    expect(missing.refunds.refundAmount).toHaveBeenCalledTimes(1);
  });

  it('gives the held seats back itself when recording the hold fails, and closes the change', async () => {
    const s = setup();
    const update = s.changes.updateOne.getMockImplementation()!;
    let failed = false;
    s.changes.updateOne.mockImplementation((filter: Doc, set: Update) => {
      if (!failed && set.$set?.heldAt) {
        failed = true;
        return { exec: () => Promise.reject(new Error('database down')) };
      }
      return update(filter, set);
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(3200), NOW),
    ).rejects.toThrow('database down');
    expect(s.seatHolds.release).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
    expect(s.changes.docs[0]).toMatchObject({
      status: FlightChangeStatus.Expired,
      open: false,
    });
  });

  it('never counts a step as done while another call has claimed it and not recorded its work', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );
    // A repeated webhook delivery: the first call claimed the step, its work is not recorded yet.
    Object.assign(s.changes.docs[0], {
      status: FlightChangeStatus.Applying,
      paidAt: NOW,
      seatsBookedAt: NOW,
    });

    const result = await s.service.apply(
      clone(s.changes.docs[0]) as never,
      NOW,
    );

    expect(result).toBe('unfinished');
    expect(s.seatHolds.confirm).not.toHaveBeenCalled();
    expect(s.bookings.updateOne).not.toHaveBeenCalled();
    expect(s.changes.docs[0].status).toBe(FlightChangeStatus.Applying);
  });

  it('records each finished step, so a later call skips it', async () => {
    const s = setup({
      flights: [flight(), toFlight(FARE)],
      airline: airlineWith(4000),
    });

    await s.service.change(BOOKING.toString(), USER.toString(), change(0), NOW);

    expect(s.changes.docs[0].doneSteps).toEqual([
      'seatsBookedAt',
      'oldSeatsReleasedAt',
      'chosenSeatsFreedAt',
    ]);
  });

  it('tells whether a change of a booking is being applied (FLT-26)', async () => {
    const s = setup();
    await s.service.change(
      BOOKING.toString(),
      USER.toString(),
      change(3200),
      NOW,
    );

    await expect(s.service.hasApplyingChange(BOOKING)).resolves.toBe(false);
    s.changes.docs[0].status = FlightChangeStatus.Applying;
    await expect(s.service.hasApplyingChange(BOOKING)).resolves.toBe(true);
  });

  it('abandons a change whose booking total moved since it was planned (another change of the other flight)', async () => {
    const s = setup({
      flights: [flight(), toFlight(FARE)],
      airline: airlineWith(4000),
    });
    s.seatHolds.confirm.mockImplementationOnce(() => {
      s.bookings.docs[0].total = 16_000;
      return Promise.resolve(true);
    });

    await expect(
      s.service.change(BOOKING.toString(), USER.toString(), change(0), NOW),
    ).rejects.toThrow(new ConflictException(CHANGE_BOOKING_CHANGED_MESSAGE));
    expect(s.bookings.docs[0].segments).toEqual([
      expect.objectContaining({ flightId: FROM }),
    ]);
    expect(s.seatHolds.unbook).toHaveBeenCalledWith(TO, CabinClass.Economy, 1);
  });
});
