import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { AirlinesService } from '../flights/airlines.service';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import type {
  HoldFlightBookingDto,
  PassengerDetailsDto,
} from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import { FLIGHT_CHANGED_MESSAGE } from './flight-bookings.constants';
import type { FlightBookingConfirmationService } from './flight-booking-confirmation.service';
import {
  BOOKING_NOT_FOUND_MESSAGE,
  FlightBookingsService,
  fareTotalOf,
  infantFareOf,
} from './flight-bookings.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const FLIGHT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const NOW = new Date('2026-11-19T10:00:00.000Z');
const TEN_MINUTES_LATER = new Date('2026-11-19T10:10:00.000Z');
const DEPARTURE = '2026-12-20';

const adult = (passport = 'ADULT0001', extra: object = {}) =>
  ({
    fullName: 'Adult Passenger',
    dateOfBirth: '1990-05-14',
    passportNumber: passport,
    ...extra,
  }) as PassengerDetailsDto;
const child = { ...adult('CHILD0001'), dateOfBirth: '2018-01-01' };
const infant = { ...adult('INFANT001'), dateOfBirth: '2026-01-01' };

/** Two adults, a child and an infant: 3 seats. */
const dto = (
  passengers: PassengerDetailsDto[] = [
    adult(),
    adult('ADULT0002'),
    child,
    infant,
  ],
): HoldFlightBookingDto => ({
  flightId: FLIGHT_ID.toString(),
  cabin: CabinClass.Economy,
  passengers,
});

/** The flight as the seat update left it, with this economy price. */
const heldFlight = (
  price = 25000,
  fields: { departureDateLocal?: string; maxBagKg?: number } = {},
) => ({
  _id: FLIGHT_ID,
  airlineId: AIRLINE_ID,
  departureDateLocal:
    'departureDateLocal' in fields ? fields.departureDateLocal : DEPARTURE,
  cabins: [
    {
      _id: new Types.ObjectId(),
      cabin: CabinClass.Business,
      totalSeats: 20,
      bookedSeats: 0,
      heldSeats: 0,
      price: 99999,
      freeBags: 2,
      maxBagKg: 32,
    },
    {
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
      totalSeats: 180,
      bookedSeats: 0,
      heldSeats: 3,
      price,
      freeBags: 1,
      maxBagKg: fields.maxBagKg ?? 23,
    },
  ],
});

/** The light read before the hold. */
const plannedFlight = (fields: Record<string, unknown> = {}) => ({
  _id: FLIGHT_ID,
  airlineId: AIRLINE_ID,
  status: FlightStatus.Scheduled,
  departureAt: new Date('2026-12-20T08:00:00.000Z'),
  departureDateLocal: DEPARTURE,
  cabins: [
    { cabin: CabinClass.Business, maxBagKg: 32 },
    {
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
      totalSeats: 180,
      bookedSeats: 0,
      heldSeats: 3,
      price: 25000,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  ...fields,
});

/** The airline's policy (FLT-08, FLT-09), as stored: highest threshold first. */
const airlinePolicy = () => ({
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
  extraBagPrice: 4500,
  maxExtraBags: 2,
});

/** `null`: an airline stored without a policy. */
function setup(
  policy: Record<string, unknown> | null = airlinePolicy(),
  airlineFields: Record<string, unknown> = {},
) {
  const calls: string[] = [];
  const read = jest.fn<Promise<unknown>, []>(() =>
    Promise.resolve(plannedFlight()),
  );
  const select = jest.fn(() => ({ lean: () => ({ exec: read }) }));
  const flights = {
    findById: jest.fn(() => {
      calls.push('flight');
      return { select };
    }),
  };
  const seatHolds = {
    hold: jest.fn<Promise<unknown>, unknown[]>(() => {
      calls.push('hold');
      return Promise.resolve(heldFlight());
    }),
    release: jest.fn<Promise<boolean>, unknown[]>(() => {
      calls.push('release');
      return Promise.resolve(true);
    }),
  };
  const bookings = {
    create: jest.fn((doc: Record<string, unknown>) => {
      calls.push('create');
      const stored = { ...doc, createdAt: NOW, updatedAt: NOW };
      return Promise.resolve({ toObject: () => stored });
    }),
  };
  const airlines = {
    findEntityOrThrow: jest.fn<Promise<unknown>, unknown[]>(() => {
      calls.push('airline');
      return Promise.resolve({
        _id: AIRLINE_ID,
        name: 'Nile Air',
        code: 'NP',
        policy: policy ?? undefined,
        ...airlineFields,
      });
    }),
  };
  /** FLT-21: the flight as the API returns it; the real one is tested in the flights module. */
  const flightResponses = {
    toResponse: jest.fn(() => Promise.resolve({ id: FLIGHT_ID.toString() })),
  };
  const service = new FlightBookingsService(
    bookings as never,
    flights as never,
    seatHolds as unknown as FlightSeatHoldsService,
    airlines as unknown as AirlinesService,
    flightResponses as unknown as FlightResponsesService,
    {} as FlightBookingConfirmationService,
  );
  return {
    service,
    flights,
    select,
    read,
    seatHolds,
    bookings,
    airlines,
    flightResponses,
    calls,
  };
}

/** The saved booking. */
const saved = (bookings: ReturnType<typeof setup>['bookings']) =>
  bookings.create.mock.calls[0][0] as Record<string, unknown> & {
    segments: Record<string, unknown>[];
    passengers: Record<string, unknown>[];
  };

/** The 400 body's field errors. */
const fieldErrors = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    (error as BadRequestException).getResponse() as {
      message: string;
      errors: { field: string; messages: string[] }[];
    }
  ).errors;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('infant fare (FLT-12)', () => {
  it('is 10% of the fare, rounded to a whole minor unit', () => {
    expect(infantFareOf(25000)).toBe(2500);
    expect(infantFareOf(25005)).toBe(2501); // 2500.5
    expect(infantFareOf(25004)).toBe(2500); // 2500.4
    expect(infantFareOf(1)).toBe(0); // 0.1
  });

  it('adds every seat at the fare and every infant at the infant fare', () => {
    expect(fareTotalOf(25005, 3, 2)).toBe(3 * 25005 + 2 * 2501);
    expect(fareTotalOf(25000, 1, 0)).toBe(25000);
  });
});

describe('FlightBookingsService.hold (FLT-22, FLT-19)', () => {
  it('reads the flight and the airline, then holds adults + children seats at one `now`, then saves', async () => {
    const { service, flights, select, seatHolds, calls } = setup();

    await service.hold(USER_ID, dto());

    expect(calls).toEqual(['flight', 'airline', 'hold', 'create']);
    expect(flights.findById).toHaveBeenCalledWith(FLIGHT_ID.toString());
    expect(select).toHaveBeenCalledWith(
      'airlineId flightNumber departureAirport arrivalAirport departureAt arrivalAt departureDateLocal status cabins createdAt updatedAt',
    );
    expect(seatHolds.hold).toHaveBeenCalledWith(
      FLIGHT_ID.toString(),
      CabinClass.Economy,
      3,
      NOW,
    );
  });

  it('saves a pending_payment booking with the derived types, priced from the returned flight', async () => {
    const { service, seatHolds, bookings } = setup();
    seatHolds.hold.mockImplementationOnce(() =>
      Promise.resolve(heldFlight(30005)),
    );

    await service.hold(USER_ID, dto());

    const fareTotal = 3 * 30005 + 1 * 3001; // infant: round(3000.5)
    expect(bookings.create).toHaveBeenCalledWith({
      _id: expect.any(Types.ObjectId),
      userId: new Types.ObjectId(USER_ID),
      status: FlightBookingStatus.PendingPayment,
      holdExpiresAt: TEN_MINUTES_LATER,
      currency: 'USD',
      fareTotal,
      baggageTotal: 0,
      total: fareTotal,
      segments: [
        {
          flightId: FLIGHT_ID,
          airlineId: AIRLINE_ID,
          cabin: CabinClass.Economy,
          fare: 30005,
          seatsReserved: 3,
          cancellationTiers: [
            { daysBefore: 30, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
          extraBagPrice: 4500,
          maxExtraBags: 2,
          freeBags: 1,
          maxBagKg: 23,
        },
      ],
      passengerCounts: { adults: 2, children: 1, infants: 1 },
      passengers: [
        {
          fullName: 'Adult Passenger',
          dateOfBirth: '1990-05-14',
          passportNumber: 'ADULT0001',
          type: PassengerType.Adult,
          baggage: [],
        },
        expect.objectContaining({ type: PassengerType.Adult }),
        expect.objectContaining({
          passportNumber: 'CHILD0001',
          type: PassengerType.Child,
        }),
        expect.objectContaining({
          passportNumber: 'INFANT001',
          type: PassengerType.Infant,
        }),
      ],
    });
  });

  it('adds the extra bag fees to the total and stores the bags on segment 0', async () => {
    const { service, bookings } = setup();

    const response = await service.hold(
      USER_ID,
      dto([
        adult('ADULT0001', { extraBags: { bags: 2, weightKg: 40 } }),
        adult('ADULT0002', { extraBags: { bags: 1, weightKg: 23 } }),
      ]),
    );

    const booking = saved(bookings);
    expect(booking.fareTotal).toBe(2 * 25000);
    expect(booking.baggageTotal).toBe(3 * 4500);
    expect(booking.total).toBe(2 * 25000 + 3 * 4500);
    expect(booking.passengers[0].baggage).toEqual([
      { segment: 0, bags: 2, weightKg: 40 },
    ]);
    expect(response).toMatchObject({
      baggageTotal: 13500,
      total: 63500,
      passengers: [
        { extraBags: { bags: 2, weightKg: 40 } },
        { extraBags: { bags: 1, weightKg: 23 } },
      ],
    });
  });

  it('returns the booking through the mapper, without the owner', async () => {
    const { service } = setup();

    const response = await service.hold(USER_ID, dto());

    expect(response).toMatchObject({
      status: 'pending_payment',
      holdExpiresAt: '2026-11-19T10:10:00.000Z',
      currency: 'USD',
      fareTotal: 3 * 25000 + 2500,
      baggageTotal: 0,
      total: 3 * 25000 + 2500,
      segments: [
        {
          flightId: FLIGHT_ID.toString(),
          cabin: 'economy',
          fare: 25000,
          seatsReserved: 3,
        },
      ],
      passengerCounts: { adults: 2, children: 1, infants: 1 },
      createdAt: '2026-11-19T10:00:00.000Z',
    });
    expect(response.passengers.map(({ type }) => type)).toEqual([
      'adult',
      'adult',
      'child',
      'infant',
    ]);
    expect(response.id).toMatch(/^[0-9a-f]{24}$/);
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('reference');
  });

  describe('answers 400 before anything is held', () => {
    it('for a booking without an adult on the departure date', async () => {
      const { service, seatHolds, bookings } = setup();

      const errors = await fieldErrors(service.hold(USER_ID, dto([child])));

      expect(errors).toEqual([
        {
          field: 'passengers',
          messages: [
            'A booking needs at least one adult (12 or older on the departure date)',
          ],
        },
      ]);
      expect(seatHolds.hold).not.toHaveBeenCalled();
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('for extra bags from an airline that sells none, on that passenger', async () => {
      const { service, seatHolds } = setup({ cancellationTiers: [] });

      const errors = await fieldErrors(
        service.hold(
          USER_ID,
          dto([
            adult(),
            adult('ADULT0002', { extraBags: { bags: 1, weightKg: 5 } }),
          ]),
        ),
      );

      expect(errors).toEqual([
        {
          field: 'passengers.1.extraBags',
          messages: ['This airline sells no extra bags'],
        },
      ]);
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it("for a weight above bags × the cabin's maxBagKg", async () => {
      const { service, seatHolds } = setup();

      const errors = await fieldErrors(
        service.hold(
          USER_ID,
          dto([adult('ADULT0001', { extraBags: { bags: 2, weightKg: 47 } })]),
        ),
      );

      expect(errors[0].field).toBe('passengers.0.extraBags.weightKg');
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });
  });

  it('answers 404 and holds nothing when the flight does not exist', async () => {
    const { service, read, seatHolds, airlines } = setup();
    read.mockResolvedValueOnce(null);

    await expect(service.hold(USER_ID, dto())).rejects.toThrow(
      new NotFoundException('Flight not found'),
    );
    expect(airlines.findEntityOrThrow).not.toHaveBeenCalled();
    expect(seatHolds.hold).not.toHaveBeenCalled();
  });

  it('answers "Flight not found" and holds nothing when the airline is missing', async () => {
    const { service, seatHolds, airlines, bookings } = setup();
    airlines.findEntityOrThrow.mockImplementationOnce(() =>
      Promise.reject(new NotFoundException('Airline not found')),
    );

    await expect(service.hold(USER_ID, dto())).rejects.toThrow(
      new NotFoundException('Flight not found'),
    );
    expect(seatHolds.hold).not.toHaveBeenCalled();
    expect(seatHolds.release).not.toHaveBeenCalled();
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('passes on any other error of the airline read, holding nothing', async () => {
    const { service, seatHolds, airlines } = setup();
    const failure = new Error('database down');
    airlines.findEntityOrThrow.mockImplementationOnce(() =>
      Promise.reject(failure),
    );

    await expect(service.hold(USER_ID, dto())).rejects.toBe(failure);
    expect(seatHolds.hold).not.toHaveBeenCalled();
  });

  describe('gives the 404 and 409 of the hold before any 400 (ACC-15, FLT-30)', () => {
    /** A body that breaks the bag rule and the adult rule. */
    const invalid = () =>
      dto([{ ...child, extraBags: { bags: 9, weightKg: 999 } }]);

    it('answers 404 "Flight not found" for a deactivated airline, without its bag rule', async () => {
      const { service, seatHolds } = setup(airlinePolicy(), { active: false });

      const error: unknown = await service
        .hold(USER_ID, invalid())
        .catch((caught: unknown) => caught);

      expect(error).toEqual(new NotFoundException('Flight not found'));
      expect(JSON.stringify(error)).not.toContain('extra bag');
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelled', { status: FlightStatus.Cancelled }],
      [
        'whose departure time has passed',
        { departureAt: new Date('2026-11-19T09:00:00.000Z') },
      ],
    ])('answers 409 for a flight %s', async (_label, fields) => {
      const { service, read, seatHolds } = setup();
      read.mockResolvedValueOnce(plannedFlight(fields));

      await expect(service.hold(USER_ID, invalid())).rejects.toThrow(
        new ConflictException('This flight can no longer be booked'),
      );
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it('answers 404 for a cabin the flight does not have', async () => {
      const { service, read, seatHolds } = setup();
      read.mockResolvedValueOnce(
        plannedFlight({
          cabins: [{ cabin: CabinClass.Business, maxBagKg: 32 }],
        }),
      );

      await expect(service.hold(USER_ID, invalid())).rejects.toThrow(
        new NotFoundException('This flight has no economy cabin'),
      );
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it('counts an airline stored before ACC-15, without `active`, as active', async () => {
      const { service, seatHolds } = setup(airlinePolicy(), {
        active: undefined,
      });

      await service.hold(USER_ID, dto());

      expect(seatHolds.hold).toHaveBeenCalled();
    });
  });

  it('saves nothing when the seats cannot be held', async () => {
    const { service, seatHolds, bookings } = setup();
    const refused = new ConflictException(
      'Not enough seats left in this cabin',
    );
    seatHolds.hold.mockImplementationOnce(() => Promise.reject(refused));

    await expect(service.hold(USER_ID, dto())).rejects.toBe(refused);
    expect(bookings.create).not.toHaveBeenCalled();
    expect(seatHolds.release).not.toHaveBeenCalled();
  });

  it.each([
    ['the departure date', { departureDateLocal: '2026-12-21' }],
    ['the departure date is missing', { departureDateLocal: undefined }],
    ["the cabin's bag weight", { maxBagKg: 20 }],
  ])(
    'releases the seats and answers 409 when %s changed between the read and the hold',
    async (_label, fields) => {
      const { service, seatHolds, bookings, calls } = setup();
      seatHolds.hold.mockImplementationOnce(() => {
        calls.push('hold');
        return Promise.resolve(heldFlight(25000, fields));
      });

      await expect(service.hold(USER_ID, dto())).rejects.toThrow(
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      );
      expect(calls).toEqual(['flight', 'airline', 'hold', 'release']);
      expect(seatHolds.release).toHaveBeenCalledWith(
        FLIGHT_ID,
        CabinClass.Economy,
        3,
      );
      expect(bookings.create).not.toHaveBeenCalled();
    },
  );

  it('releases the seats and rethrows when saving fails', async () => {
    const { service, seatHolds, bookings, calls } = setup();
    const failure = new Error('write failed');
    bookings.create.mockImplementationOnce(() => {
      calls.push('create');
      return Promise.reject(failure);
    });

    await expect(service.hold(USER_ID, dto())).rejects.toBe(failure);
    expect(calls).toEqual(['flight', 'airline', 'hold', 'create', 'release']);
    expect(seatHolds.release).toHaveBeenCalledWith(
      FLIGHT_ID,
      CabinClass.Economy,
      3,
    );
  });

  it('still rethrows the save error when the release fails too, and logs no personal data', async () => {
    const { service, seatHolds, bookings } = setup();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failure = new Error('write failed');
    bookings.create.mockImplementationOnce(() => Promise.reject(failure));
    seatHolds.release.mockImplementationOnce(() =>
      Promise.reject(new Error('release failed')),
    );

    await expect(service.hold(USER_ID, dto())).rejects.toBe(failure);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls);
    for (const personal of ['ADULT0001', '1990-05-14', 'Adult Passenger']) {
      expect(logged).not.toContain(personal);
    }
    error.mockRestore();
  });
});

describe('FlightBookingsService.hold copies the policy (PAY-02)', () => {
  it("copies the airline's tiers and extra-bag rule and the held cabin's free allowance", async () => {
    const { service, airlines, bookings } = setup();

    await service.hold(USER_ID, dto());

    expect(airlines.findEntityOrThrow).toHaveBeenCalledWith(
      AIRLINE_ID.toString(),
    );
    expect(saved(bookings).segments[0]).toMatchObject({
      cancellationTiers: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ],
      extraBagPrice: 4500,
      maxExtraBags: 2,
      // The economy cabin, not the business one of the same flight.
      freeBags: 1,
      maxBagKg: 23,
    });
  });

  it('copies the tiers as plain values, so the booking keeps them when the airline changes', async () => {
    const policy = airlinePolicy();
    const { service, bookings } = setup(policy);

    await service.hold(USER_ID, dto());
    policy.cancellationTiers[0].refundPercent = 0;

    expect(saved(bookings).segments[0].cancellationTiers).toEqual([
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ]);
  });

  it.each([
    ['no policy at all', null],
    ['an empty policy', { cancellationTiers: [] }],
  ])(
    'gives no tiers, no extra-bag price and 0 extra bags for an airline with %s',
    async (_label, policy) => {
      const { service, bookings } = setup(policy);

      await service.hold(USER_ID, dto());

      const segment = saved(bookings).segments[0];
      expect(segment.cancellationTiers).toEqual([]);
      expect(segment.extraBagPrice).toBeUndefined();
      expect(segment.maxExtraBags).toBe(0);
      expect(segment).toMatchObject({ freeBags: 1, maxBagKg: 23 });
    },
  );
});

describe('FlightBookingsService owner lookup and policy acceptance (PAY-02)', () => {
  const BOOKING_ID = '6740f1c2a4b5c6d7e8f90789';
  const OWNER_ID = '6740f1c2a4b5c6d7e8f90123';
  const AT = new Date('2026-11-19T10:02:00.000Z');

  /** A fake model whose `findOne` and `findOneAndUpdate` resolve to `found`. */
  const ownedSetup = (found: unknown) => {
    const query = () => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(found),
    });
    const bookings = {
      findOne: jest.fn(query),
      findOneAndUpdate: jest.fn(query),
    };
    const service = new FlightBookingsService(
      bookings as never,
      {} as never,
      {} as FlightSeatHoldsService,
      {} as AirlinesService,
      {} as FlightResponsesService,
      {} as FlightBookingConfirmationService,
    );
    return { service, bookings };
  };

  it("finds the user's own booking by id and owner", async () => {
    const stored = { _id: BOOKING_ID, status: 'pending_payment' };
    const { service, bookings } = ownedSetup(stored);

    await expect(
      service.findOwnedEntityOrThrow(BOOKING_ID, OWNER_ID),
    ).resolves.toBe(stored);
    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID,
      userId: new Types.ObjectId(OWNER_ID),
    });
  });

  it("answers 404 for a missing booking or another user's, with the same message", async () => {
    const { service } = ownedSetup(null);

    const error: unknown = await service
      .findOwnedEntityOrThrow(BOOKING_ID, OWNER_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe('Booking not found');
    expect(BOOKING_NOT_FOUND_MESSAGE).toBe('Booking not found');
  });

  it('accepts with one conditional update: owner, pending, live hold, not accepted before', async () => {
    const accepted = { _id: BOOKING_ID, policyAcceptedAt: AT };
    const { service, bookings } = ownedSetup(accepted);

    await expect(
      service.acceptPolicies(BOOKING_ID, OWNER_ID, AT),
    ).resolves.toBe(accepted);
    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(bookings.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: BOOKING_ID,
        userId: new Types.ObjectId(OWNER_ID),
        status: 'pending_payment',
        holdExpiresAt: { $gt: AT },
        policyAcceptedAt: { $exists: false },
      },
      { $set: { policyAcceptedAt: AT } },
      { returnDocument: 'after' },
    );
  });

  it('returns null when nothing matched', async () => {
    const { service } = ownedSetup(null);

    await expect(
      service.acceptPolicies(BOOKING_ID, OWNER_ID, AT),
    ).resolves.toBeNull();
  });
});

describe('FlightBookingsService.summarise (FLT-21)', () => {
  /** One adult with 2 extra bags, a second adult, a child and an infant. */
  const withBags = () =>
    dto([
      adult('ADULT0001', { extraBags: { bags: 2, weightKg: 40 } }),
      adult('ADULT0002'),
      child,
      infant,
    ]);

  const errorOf = async (call: Promise<unknown>): Promise<Error> => {
    const error: unknown = await call.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  };

  it('builds the summary from one read, without holding or saving anything', async () => {
    const { service, seatHolds, bookings, flightResponses, calls } = setup();

    const summary = await service.summarise(withBags());

    expect(calls).toEqual(['flight', 'airline']);
    expect(seatHolds.hold).not.toHaveBeenCalled();
    expect(seatHolds.release).not.toHaveBeenCalled();
    expect(bookings.create).not.toHaveBeenCalled();
    expect(flightResponses.toResponse).toHaveBeenCalledWith(
      expect.objectContaining({ _id: FLIGHT_ID }),
      NOW,
    );
    expect(summary).toMatchObject({
      flight: { id: FLIGHT_ID.toString() },
      airline: { id: AIRLINE_ID.toString(), name: 'Nile Air', code: 'NP' },
      cabin: 'economy',
      seats: 3,
      passengerCounts: { adults: 2, children: 1, infants: 1 },
      baggage: {
        freeBags: 1,
        maxBagKg: 23,
        extraBagPrice: 4500,
        maxExtraBags: 2,
      },
      currency: 'USD',
      fareTotal: 3 * 25000 + 2500,
      baggageTotal: 9000,
      total: 3 * 25000 + 2500 + 9000,
    });
    expect(
      summary.passengers.map(({ type, fare, baggageFee }) => ({
        type,
        fare,
        baggageFee,
      })),
    ).toEqual([
      { type: PassengerType.Adult, fare: 25000, baggageFee: 9000 },
      { type: PassengerType.Adult, fare: 25000, baggageFee: 0 },
      { type: PassengerType.Child, fare: 25000, baggageFee: 0 },
      { type: PassengerType.Infant, fare: 2500, baggageFee: 0 },
    ]);
    expect(summary.priceNote).toContain('POST /api/flight-bookings/hold');
  });

  it('gives the same totals the hold saves for the same passengers and cabin price', async () => {
    const summarised = setup();
    const held = setup();

    const summary = await summarised.service.summarise(withBags());
    await held.service.hold(USER_ID, withBags());

    const saved = held.bookings.create.mock.calls[0][0] as Record<
      string,
      number
    >;
    expect({
      fareTotal: summary.fareTotal,
      baggageTotal: summary.baggageTotal,
      total: summary.total,
    }).toEqual({
      fareTotal: saved.fareTotal,
      baggageTotal: saved.baggageTotal,
      total: saved.total,
    });
  });

  it('answers 409 when the cabin has too few seats left, and holds nothing', async () => {
    const { service, read, seatHolds } = setup();
    read.mockImplementationOnce(() =>
      Promise.resolve(
        plannedFlight({
          cabins: [
            {
              _id: new Types.ObjectId(),
              cabin: CabinClass.Economy,
              totalSeats: 180,
              bookedSeats: 100,
              heldSeats: 78,
              price: 25000,
              freeBags: 1,
              maxBagKg: 23,
            },
          ],
        }),
      ),
    );

    const error = await errorOf(service.summarise(dto()));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('Not enough seats left in this cabin');
    expect(seatHolds.hold).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing flight', async () => {
    const { service, read, airlines } = setup();
    read.mockImplementationOnce(() => Promise.resolve(null));

    const error = await errorOf(service.summarise(dto()));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Flight not found');
    expect(airlines.findEntityOrThrow).not.toHaveBeenCalled();
  });

  it('answers 404 for a deactivated airline before a 400 on the passengers', async () => {
    const { service } = setup(airlinePolicy(), { active: false });

    const error = await errorOf(service.summarise(dto([child])));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Flight not found');
  });

  it('answers 409 for a flight that can no longer be booked, before a 400', async () => {
    const { service, read } = setup();
    read.mockImplementationOnce(() =>
      Promise.resolve(plannedFlight({ status: FlightStatus.Cancelled })),
    );

    const error = await errorOf(service.summarise(dto([child])));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('This flight can no longer be booked');
  });

  it('answers 404 for a cabin the flight does not have', async () => {
    const { service } = setup();

    const error = await errorOf(
      service.summarise({ ...dto(), cabin: CabinClass.First }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('This flight has no first cabin');
  });

  it('answers 400 on the field paths for passengers that break a rule, and holds nothing', async () => {
    const { service, seatHolds, bookings } = setup();

    const error = await errorOf(service.summarise(dto([child])));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      (error as BadRequestException).getResponse() as { message: string },
    ).toMatchObject({ message: 'Validation failed' });
    expect(seatHolds.hold).not.toHaveBeenCalled();
    expect(bookings.create).not.toHaveBeenCalled();
  });
});

describe('FlightBookingsService.findTravellerIdsOfAirline (ACC-15)', () => {
  const AT = new Date('2026-11-19T10:00:00.000Z');
  const FUTURE_FLIGHT = new Types.ObjectId();
  const OTHER_FUTURE_FLIGHT = new Types.ObjectId();
  const TRAVELLER_A = new Types.ObjectId();
  const TRAVELLER_B = new Types.ObjectId();

  /** Fake models whose `distinct` resolves to the given ids. */
  const lookupSetup = (
    flightIds: Types.ObjectId[],
    userIds: Types.ObjectId[] = [],
  ) => {
    const distinctOf = (result: Types.ObjectId[]) =>
      jest.fn(() => ({ exec: jest.fn().mockResolvedValue(result) }));
    const flights = { distinct: distinctOf(flightIds) };
    const bookings = { distinct: distinctOf(userIds) };
    const service = new FlightBookingsService(
      bookings as never,
      flights as never,
      {} as FlightSeatHoldsService,
      {} as AirlinesService,
      {} as FlightResponsesService,
      {} as FlightBookingConfirmationService,
    );
    return { service, flights, bookings };
  };

  it("reads the airline's flights departing after now, then the confirmed bookings on them", async () => {
    const { service, flights, bookings } = lookupSetup(
      [FUTURE_FLIGHT, OTHER_FUTURE_FLIGHT],
      [TRAVELLER_A, TRAVELLER_B],
    );

    await expect(
      service.findTravellerIdsOfAirline(AIRLINE_ID, AT),
    ).resolves.toEqual([TRAVELLER_A, TRAVELLER_B]);

    expect(flights.distinct).toHaveBeenCalledTimes(1);
    expect(flights.distinct).toHaveBeenCalledWith('_id', {
      airlineId: AIRLINE_ID,
      departureAt: { $gt: AT },
    });
    expect(bookings.distinct).toHaveBeenCalledTimes(1);
    expect(bookings.distinct).toHaveBeenCalledWith('userId', {
      status: FlightBookingStatus.Confirmed,
      'segments.flightId': { $in: [FUTURE_FLIGHT, OTHER_FUTURE_FLIGHT] },
    });
  });

  it('asks only for confirmed bookings, never pending, expired, cancelled or completed ones', async () => {
    const { service, bookings } = lookupSetup([FUTURE_FLIGHT]);

    await service.findTravellerIdsOfAirline(AIRLINE_ID, AT);

    const [, filter] = bookings.distinct.mock.calls[0] as unknown as [
      string,
      { status: string },
    ];
    expect(filter.status).toBe('confirmed');
  });

  it('returns [] and reads no booking when the airline has no future flight', async () => {
    const { service, bookings } = lookupSetup([]);

    await expect(
      service.findTravellerIdsOfAirline(AIRLINE_ID, AT),
    ).resolves.toEqual([]);
    expect(bookings.distinct).not.toHaveBeenCalled();
  });

  it('writes nothing', async () => {
    const { service, flights, bookings } = lookupSetup(
      [FUTURE_FLIGHT],
      [TRAVELLER_A],
    );

    await service.findTravellerIdsOfAirline(AIRLINE_ID, AT);

    expect(Object.keys(flights)).toEqual(['distinct']);
    expect(Object.keys(bookings)).toEqual(['distinct']);
  });
});

describe('FlightBookingsService.hasConfirmedBooking and hasLiveHold (ACC-12)', () => {
  const NOW = new Date('2026-11-20T10:00:00.000Z');

  /** A fake model whose `exists` resolves to the given answer. */
  const existsSetup = (found: { _id: Types.ObjectId } | null) => {
    const bookings = {
      exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(found) })),
    };
    const service = new FlightBookingsService(
      bookings as never,
      {} as never,
      {} as FlightSeatHoldsService,
      {} as AirlinesService,
      {} as FlightResponsesService,
      {} as FlightBookingConfirmationService,
    );
    return { service, bookings };
  };

  it('asks for a confirmed booking of the user only', async () => {
    const { service, bookings } = existsSetup({ _id: new Types.ObjectId() });

    await expect(service.hasConfirmedBooking(USER_ID)).resolves.toBe(true);

    expect(bookings.exists).toHaveBeenCalledTimes(1);
    expect(bookings.exists).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER_ID),
      status: FlightBookingStatus.Confirmed,
    });
  });

  it('answers false when the user has no confirmed booking', async () => {
    const { service } = existsSetup(null);

    await expect(service.hasConfirmedBooking(USER_ID)).resolves.toBe(false);
  });

  it('asks for a booking of the user waiting for payment whose hold ends after now', async () => {
    const { service, bookings } = existsSetup({ _id: new Types.ObjectId() });

    await expect(service.hasLiveHold(USER_ID, NOW)).resolves.toBe(true);

    expect(bookings.exists).toHaveBeenCalledTimes(1);
    expect(bookings.exists).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER_ID),
      status: FlightBookingStatus.PendingPayment,
      holdExpiresAt: { $gt: NOW },
    });
  });

  it('answers false when the user has no live hold', async () => {
    const { service } = existsSetup(null);

    await expect(service.hasLiveHold(USER_ID, NOW)).resolves.toBe(false);
  });

  it('throws for an id that is not an ObjectId, like the other lookups, and reads nothing', async () => {
    const { service, bookings } = existsSetup(null);

    await expect(service.hasConfirmedBooking('not-an-id')).rejects.toThrow();
    await expect(service.hasLiveHold('not-an-id', NOW)).rejects.toThrow();
    expect(bookings.exists).not.toHaveBeenCalled();
  });

  it('writes nothing', async () => {
    const { service, bookings } = existsSetup(null);

    await service.hasConfirmedBooking(USER_ID);
    await service.hasLiveHold(USER_ID, NOW);

    expect(Object.keys(bookings)).toEqual(['exists']);
  });
});
