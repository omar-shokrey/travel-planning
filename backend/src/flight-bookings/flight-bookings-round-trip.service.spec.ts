import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { AirlinesService } from '../flights/airlines.service';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  type FlightSeatHoldsService,
  NOT_ENOUGH_SEATS_MESSAGE,
} from '../flights/flight-seat-holds.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import {
  NO_EXTRA_BAGS_MESSAGE,
  tooHeavyMessage,
  tooManyBagsMessage,
} from './booking-passengers';
import type {
  HoldFlightBookingDto,
  PassengerDetailsDto,
} from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import {
  FLIGHT_CHANGED_MESSAGE,
  INFANT_ON_RETURN_MESSAGE,
  RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  returnRouteMessage,
} from './flight-bookings.constants';
import type { FlightBookingConfirmationService } from './flight-booking-confirmation.service';
import {
  FlightBookingsService,
  forReturnFlight,
  returnLeavesAfterArrival,
} from './flight-bookings.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const OUT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const RET_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');
const OUT_AIRLINE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const RET_AIRLINE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90888');
const NOW = new Date('2026-11-19T10:00:00.000Z');
const TEN_MINUTES_LATER = new Date('2026-11-19T10:10:00.000Z');

const OUT_TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
];
const RET_TIERS = [{ daysBefore: 3, refundPercent: 25 }];

const adult = (passport = 'ADULT0001', extra: object = {}) =>
  ({
    fullName: 'Adult Passenger',
    dateOfBirth: '1990-05-14',
    passportNumber: passport,
    ...extra,
  }) as PassengerDetailsDto;
/** 1 year old on both dates. */
const infant = { ...adult('INFANT001'), dateOfBirth: '2025-06-01' };
/** An infant on 2026-12-20 who turns 2 on 2026-12-25, before the return. */
const turnsTwo = { ...adult('INFANT002'), dateOfBirth: '2024-12-25' };

/** An adult with extra bags back, and an infant: 1 seat on each flight. */
const roundTrip = (
  passengers: PassengerDetailsDto[] = [
    adult('ADULT0001', { returnExtraBags: { bags: 1, weightKg: 20 } }),
    infant,
  ],
  change: Partial<HoldFlightBookingDto> = {},
): HoldFlightBookingDto => ({
  flightId: OUT_ID.toString(),
  cabin: CabinClass.Economy,
  returnFlightId: RET_ID.toString(),
  returnCabin: CabinClass.Business,
  passengers,
  ...change,
});

const cabins = (economy: number, business: number, businessKg = 32) => [
  {
    _id: new Types.ObjectId(),
    cabin: CabinClass.Economy,
    totalSeats: 100,
    bookedSeats: 0,
    heldSeats: 0,
    price: economy,
    freeBags: 1,
    maxBagKg: 23,
  },
  {
    _id: new Types.ObjectId(),
    cabin: CabinClass.Business,
    totalSeats: 10,
    bookedSeats: 0,
    heldSeats: 0,
    price: business,
    freeBags: 2,
    maxBagKg: businessKg,
  },
];

/** The light reads before the hold: Cairo to New York, and back a week later. */
const outbound = (fields: Record<string, unknown> = {}) => ({
  _id: OUT_ID,
  airlineId: OUT_AIRLINE,
  flightNumber: 'NP100',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2026-12-20T08:00:00.000Z'),
  arrivalAt: new Date('2026-12-20T20:00:00.000Z'),
  departureDateLocal: '2026-12-20',
  status: FlightStatus.Scheduled,
  cabins: cabins(25000, 90000),
  ...fields,
});
const back = (fields: Record<string, unknown> = {}) => ({
  _id: RET_ID,
  airlineId: RET_AIRLINE,
  flightNumber: 'DS200',
  departureAirport: 'JFK',
  arrivalAirport: 'CAI',
  departureAt: new Date('2026-12-27T15:00:00.000Z'),
  arrivalAt: new Date('2026-12-28T06:00:00.000Z'),
  departureDateLocal: '2026-12-27',
  status: FlightStatus.Scheduled,
  cabins: cabins(30000, 60000),
  ...fields,
});

const airline = (id: Types.ObjectId, fields: Record<string, unknown> = {}) =>
  id.equals(OUT_AIRLINE)
    ? {
        _id: OUT_AIRLINE,
        name: 'Nile Air',
        code: 'NP',
        policy: {
          cancellationTiers: OUT_TIERS,
          extraBagPrice: 4500,
          maxExtraBags: 2,
        },
        ...fields,
      }
    : {
        _id: RET_AIRLINE,
        name: 'Delta Sky',
        code: 'DS',
        policy: {
          cancellationTiers: RET_TIERS,
          extraBagPrice: 4000,
          maxExtraBags: 1,
        },
        ...fields,
      };

interface Options {
  outbound?: Record<string, unknown> | null;
  back?: Record<string, unknown> | null;
  returnAirline?: Record<string, unknown>;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const docs = new Map<string, unknown>([
    [
      OUT_ID.toString(),
      options.outbound === null ? null : outbound(options.outbound ?? {}),
    ],
    [
      RET_ID.toString(),
      options.back === null ? null : back(options.back ?? {}),
    ],
  ]);
  const flights = {
    findById: jest.fn((id: string) => {
      calls.push(`read ${id === OUT_ID.toString() ? 'out' : 'ret'}`);
      return {
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(docs.get(id) ?? null) }),
        }),
      };
    }),
  };
  const airlines = {
    findEntityOrThrow: jest.fn((id: string) =>
      Promise.resolve(
        new Types.ObjectId(id).equals(RET_AIRLINE)
          ? airline(RET_AIRLINE, options.returnAirline)
          : airline(OUT_AIRLINE),
      ),
    ),
  };
  /** What each hold returns: the flight read, unless a test changes it. */
  const held = new Map<string, Record<string, unknown>>([
    [OUT_ID.toString(), outbound()],
    [RET_ID.toString(), back()],
  ]);
  const seatHolds = {
    hold: jest.fn((flightId: string, cabin: CabinClass, seats: number) => {
      calls.push(
        `hold ${flightId === OUT_ID.toString() ? 'out' : 'ret'} ${cabin} ${seats}`,
      );
      return Promise.resolve(held.get(flightId));
    }),
    release: jest.fn((flightId: Types.ObjectId, cabin: CabinClass) => {
      calls.push(`release ${flightId.equals(OUT_ID) ? 'out' : 'ret'} ${cabin}`);
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
  const flightResponses = {
    toResponse: jest.fn((flight: { _id: Types.ObjectId }) =>
      Promise.resolve({ id: flight._id.toString() }),
    ),
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
    calls,
    seatHolds,
    bookings,
    held,
    airlines,
    flightResponses,
  };
}

const saved = (bookings: ReturnType<typeof setup>['bookings']) =>
  bookings.create.mock.calls[0][0] as Record<string, unknown> & {
    segments: Record<string, unknown>[];
    passengers: Record<string, unknown>[];
  };

const fieldErrors = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    (error as BadRequestException).getResponse() as {
      errors: { field: string; messages: string[] }[];
    }
  ).errors;
};

let logError: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('FlightBookingsService.hold: round trip (FLT-12(a))', () => {
  it('reads both flights, holds the outbound then the return seats at one `now`, then saves one booking', async () => {
    const { service, calls, seatHolds } = setup();

    await service.hold(USER_ID, roundTrip());

    expect(calls).toEqual([
      'read out',
      'read ret',
      'hold out economy 1',
      'hold ret business 1',
      'create',
    ]);
    expect(seatHolds.hold).toHaveBeenNthCalledWith(
      1,
      OUT_ID.toString(),
      CabinClass.Economy,
      1,
      NOW,
    );
    expect(seatHolds.hold).toHaveBeenNthCalledWith(
      2,
      RET_ID.toString(),
      CabinClass.Business,
      1,
      NOW,
    );
    expect(seatHolds.release).not.toHaveBeenCalled();
  });

  it('saves two segments, outbound then return, each with its fare, airline policy and cabin allowance', async () => {
    const { service, bookings } = setup();

    await service.hold(USER_ID, roundTrip());

    const booking = saved(bookings);
    expect(booking.status).toBe(FlightBookingStatus.PendingPayment);
    expect(booking.holdExpiresAt).toEqual(TEN_MINUTES_LATER);
    expect(booking.segments).toEqual([
      {
        flightId: OUT_ID,
        airlineId: OUT_AIRLINE,
        cabin: CabinClass.Economy,
        fare: 25000,
        seatsReserved: 1,
        cancellationTiers: OUT_TIERS,
        extraBagPrice: 4500,
        maxExtraBags: 2,
        freeBags: 1,
        maxBagKg: 23,
      },
      {
        flightId: RET_ID,
        airlineId: RET_AIRLINE,
        cabin: CabinClass.Business,
        fare: 60000,
        seatsReserved: 1,
        cancellationTiers: RET_TIERS,
        extraBagPrice: 4000,
        maxExtraBags: 1,
        freeBags: 2,
        maxBagKg: 32,
      },
    ]);
  });

  it('totals both flights: the adult pays each fare, the infant 10% of each, bags at each airline price', async () => {
    const { service, bookings } = setup();

    await service.hold(USER_ID, roundTrip());

    // Outbound 25000 + 2500; return 60000 + 6000.
    const booking = saved(bookings);
    expect(booking.fareTotal).toBe(25000 + 2500 + 60000 + 6000);
    // One extra bag back at the return airline's price.
    expect(booking.baggageTotal).toBe(4000);
    expect(booking.total).toBe(93500 + 4000);
    expect(booking.passengerCounts).toEqual({
      adults: 1,
      children: 0,
      infants: 1,
    });
  });

  it('keeps each passenger once, with their bags per segment (0 outbound, 1 return)', async () => {
    const { service, bookings } = setup();

    await service.hold(
      USER_ID,
      roundTrip([
        adult('ADULT0001', {
          extraBags: { bags: 2, weightKg: 40 },
          returnExtraBags: { bags: 1, weightKg: 20 },
        }),
        adult('ADULT0002', { extraBags: { bags: 1, weightKg: 10 } }),
        infant,
      ]),
    );

    const booking = saved(bookings);
    expect(booking.passengers).toEqual([
      expect.objectContaining({
        passportNumber: 'ADULT0001',
        type: PassengerType.Adult,
        baggage: [
          { segment: 0, bags: 2, weightKg: 40 },
          { segment: 1, bags: 1, weightKg: 20 },
        ],
      }),
      expect.objectContaining({
        passportNumber: 'ADULT0002',
        baggage: [{ segment: 0, bags: 1, weightKg: 10 }],
      }),
      expect.objectContaining({
        passportNumber: 'INFANT001',
        type: PassengerType.Infant,
        baggage: [],
      }),
    ]);
    expect(booking.baggageTotal).toBe(3 * 4500 + 4000);
  });

  it('answers the booking with both segments and the return bags of each passenger', async () => {
    const { service } = setup();

    const response = await service.hold(USER_ID, roundTrip());

    expect(response.segments).toEqual([
      {
        flightId: OUT_ID.toString(),
        cabin: 'economy',
        fare: 25000,
        seatsReserved: 1,
      },
      {
        flightId: RET_ID.toString(),
        cabin: 'business',
        fare: 60000,
        seatsReserved: 1,
      },
    ]);
    expect(response.passengers[0]).toMatchObject({
      extraBags: null,
      returnExtraBags: { bags: 1, weightKg: 20 },
    });
    expect(response.passengers[1].returnExtraBags).toBeNull();
  });

  it('takes each fare from the flight its own hold returned', async () => {
    const { service, bookings, held } = setup();
    held.set(RET_ID.toString(), back({ cabins: cabins(30000, 61000) }));

    await service.hold(USER_ID, roundTrip());

    expect(saved(bookings).segments[1].fare).toBe(61000);
    expect(saved(bookings).fareTotal).toBe(25000 + 2500 + 61000 + 6100);
  });

  describe('nothing stays held', () => {
    it('releases the outbound seats when the return hold is refused, and names the return flight', async () => {
      const { service, seatHolds, bookings, calls } = setup();
      seatHolds.hold.mockImplementation((flightId: string) =>
        flightId === OUT_ID.toString()
          ? Promise.resolve(outbound())
          : Promise.reject(new ConflictException(NOT_ENOUGH_SEATS_MESSAGE)),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(`Return flight: ${NOT_ENOUGH_SEATS_MESSAGE}`),
      );
      expect(calls.filter((call) => call.startsWith('release'))).toEqual([
        'release out economy',
      ]);
      expect(seatHolds.release).toHaveBeenCalledWith(
        OUT_ID,
        CabinClass.Economy,
        1,
      );
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('names the return flight in a 404 of its hold too', async () => {
      const { service, seatHolds } = setup();
      seatHolds.hold.mockImplementation((flightId: string) =>
        flightId === OUT_ID.toString()
          ? Promise.resolve(outbound())
          : Promise.reject(new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE)),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new NotFoundException('Return flight: Flight not found'),
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(1);
    });

    it('holds no return seats when the outbound hold is refused, and its answer is not prefixed', async () => {
      const { service, seatHolds } = setup();
      seatHolds.hold.mockImplementation(() =>
        Promise.reject(new ConflictException(NOT_ENOUGH_SEATS_MESSAGE)),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(NOT_ENOUGH_SEATS_MESSAGE),
      );
      expect(seatHolds.hold).toHaveBeenCalledTimes(1);
      expect(seatHolds.release).not.toHaveBeenCalled();
    });

    it('releases both flights when the booking cannot be saved, and rethrows the save error', async () => {
      const { service, seatHolds, bookings, calls } = setup();
      bookings.create.mockImplementation(() =>
        Promise.reject(new Error('write failed')),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        'write failed',
      );
      expect(calls.filter((call) => call.startsWith('release'))).toEqual([
        'release out economy',
        'release ret business',
      ]);
      expect(seatHolds.release).toHaveBeenCalledWith(
        RET_ID,
        CabinClass.Business,
        1,
      );
    });

    it('logs each failed release with ids and counts only, and still rethrows the first error', async () => {
      const { service, seatHolds, bookings } = setup();
      bookings.create.mockImplementation(() =>
        Promise.reject(new Error('write failed')),
      );
      seatHolds.release.mockImplementation(() =>
        Promise.reject(new Error('release failed')),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        'write failed',
      );
      expect(logError).toHaveBeenCalledTimes(2);
      const logged = logError.mock.calls.map(([message]) => message as string);
      expect(logged[0]).toContain(OUT_ID.toString());
      expect(logged[1]).toContain(RET_ID.toString());
      for (const message of logged) {
        expect(message).not.toMatch(/Adult Passenger|ADULT0001|1990-05-14/);
      }
    });

    it('logs a failed release that is not an Error as it is', async () => {
      const { service, seatHolds, bookings } = setup();
      bookings.create.mockImplementation(() =>
        Promise.reject(new Error('write failed')),
      );
      seatHolds.release.mockImplementation(() =>
        Promise.reject('release failed'),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        'write failed',
      );
      expect(logError.mock.calls.map(([, detail]) => detail as string)).toEqual(
        ['release failed', 'release failed'],
      );
    });

    it('releases both when the return flight changed date between the read and the hold', async () => {
      const { service, held, seatHolds, bookings } = setup();
      held.set(RET_ID.toString(), back({ departureDateLocal: '2026-12-28' }));

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(2);
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('releases both when the return cabin bag weight changed', async () => {
      const { service, held, seatHolds } = setup();
      held.set(RET_ID.toString(), back({ cabins: cabins(30000, 60000, 20) }));

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(2);
    });

    it('releases both when the times changed so the return no longer leaves after the outbound arrives', async () => {
      const { service, held, seatHolds, bookings } = setup();
      // A moderator moved the outbound arrival past the return departure (FLT-05).
      held.set(
        OUT_ID.toString(),
        outbound({ arrivalAt: new Date('2026-12-27T16:00:00.000Z') }),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(2);
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('treats a returned flight without its times as changed', async () => {
      const { service, held, seatHolds } = setup();
      held.set(RET_ID.toString(), back({ departureAt: undefined }));

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(FLIGHT_CHANGED_MESSAGE),
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(2);
    });

    it('releases both and fails loudly when a returned flight lacks the held cabin', async () => {
      const { service, held, seatHolds } = setup();
      held.set(
        RET_ID.toString(),
        back({ cabins: cabins(30000, 60000).slice(0, 1) }),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        `Flight ${RET_ID.toString()} returned no business cabin after the hold`,
      );
      expect(seatHolds.release).toHaveBeenCalledTimes(2);
    });
  });

  describe('the return flight: the answers of the outbound flight, prefixed, before any 400', () => {
    it('404 when it does not exist', async () => {
      const { service, seatHolds } = setup({ back: null });

      await expect(
        service.hold(USER_ID, roundTrip([adult(), turnsTwo])),
      ).rejects.toThrow(
        new NotFoundException('Return flight: Flight not found'),
      );
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it('404 when its airline is deactivated (ACC-15)', async () => {
      const { service } = setup({ returnAirline: { active: false } });

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new NotFoundException('Return flight: Flight not found'),
      );
    });

    it('404 when its airline is missing', async () => {
      const { service, airlines } = setup();
      airlines.findEntityOrThrow.mockImplementation((id: string) =>
        new Types.ObjectId(id).equals(RET_AIRLINE)
          ? Promise.reject(new NotFoundException('Airline not found'))
          : Promise.resolve(airline(OUT_AIRLINE)),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new NotFoundException('Return flight: Flight not found'),
      );
    });

    it('409 when it can no longer be booked (FLT-30)', async () => {
      const { service } = setup({ back: { status: FlightStatus.Cancelled } });

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new ConflictException(`Return flight: ${FLIGHT_NOT_BOOKABLE_MESSAGE}`),
      );
    });

    it('404 naming the cabin it does not have', async () => {
      const { service } = setup();

      await expect(
        service.hold(
          USER_ID,
          roundTrip(undefined, { returnCabin: CabinClass.First }),
        ),
      ).rejects.toThrow(
        new NotFoundException('Return flight: This flight has no first cabin'),
      );
    });

    it('404 for a return flight stored without cabins (before FLT-04)', async () => {
      const { service } = setup({ back: { cabins: undefined } });

      await expect(service.hold(USER_ID, roundTrip())).rejects.toThrow(
        new NotFoundException(
          'Return flight: This flight has no business cabin',
        ),
      );
    });

    it('passes any other error of the read on unchanged', async () => {
      const { service, airlines } = setup();
      const failure = new Error('database down');
      airlines.findEntityOrThrow.mockImplementation((id: string) =>
        new Types.ObjectId(id).equals(RET_AIRLINE)
          ? Promise.reject(failure)
          : Promise.resolve(airline(OUT_AIRLINE)),
      );

      await expect(service.hold(USER_ID, roundTrip())).rejects.toBe(failure);
    });
  });

  describe('400: the round-trip rules, with nothing held', () => {
    it('refuses a return flight that does not fly the outbound route reversed', async () => {
      for (const route of [
        { departureAirport: 'JFK', arrivalAirport: 'LHR' },
        { departureAirport: 'CAI', arrivalAirport: 'JFK' },
        { departureAirport: 'LHR', arrivalAirport: 'CAI' },
      ]) {
        const { service, seatHolds } = setup({ back: route });

        expect(await fieldErrors(service.hold(USER_ID, roundTrip()))).toEqual([
          {
            field: 'returnFlightId',
            messages: [returnRouteMessage('CAI', 'JFK')],
          },
        ]);
        expect(seatHolds.hold).not.toHaveBeenCalled();
      }
      expect(returnRouteMessage('CAI', 'JFK')).toBe(
        'The return flight must fly from JFK to CAI, the outbound route reversed',
      );
    });

    it('refuses a return that leaves before, or exactly when, the outbound flight arrives', async () => {
      for (const departureAt of [
        new Date('2026-12-20T19:59:00.000Z'),
        new Date('2026-12-20T20:00:00.000Z'),
      ]) {
        const { service, seatHolds } = setup({
          back: { departureAt, departureDateLocal: '2026-12-20' },
        });

        expect(await fieldErrors(service.hold(USER_ID, roundTrip()))).toEqual([
          { field: 'returnFlightId', messages: [RETURN_TOO_EARLY_MESSAGE] },
        ]);
        expect(seatHolds.hold).not.toHaveBeenCalled();
      }
    });

    it('accepts a return one minute after the outbound arrival, on the same day', async () => {
      const sameDay = {
        departureAt: new Date('2026-12-20T20:01:00.000Z'),
        departureDateLocal: '2026-12-20',
      };
      const { service, bookings, held } = setup({ back: sameDay });
      held.set(RET_ID.toString(), back(sameDay));

      await service.hold(USER_ID, roundTrip([adult()]));

      expect(saved(bookings).segments).toHaveLength(2);
    });

    it('refuses an infant who is 2 or older on the return date: they would need a seat there', async () => {
      const { service, seatHolds } = setup();

      expect(
        await fieldErrors(
          service.hold(USER_ID, roundTrip([adult(), turnsTwo])),
        ),
      ).toEqual([
        {
          field: 'passengers.1.dateOfBirth',
          messages: [INFANT_ON_RETURN_MESSAGE],
        },
      ]);
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it('checks the return bags with the return airline and cabin', async () => {
      const { service } = setup();

      expect(
        await fieldErrors(
          service.hold(
            USER_ID,
            roundTrip([
              adult('ADULT0001', {
                returnExtraBags: { bags: 2, weightKg: 20 },
              }),
              adult('ADULT0002', {
                returnExtraBags: { bags: 1, weightKg: 33 },
              }),
            ]),
          ),
        ),
      ).toEqual([
        {
          field: 'passengers.0.returnExtraBags.bags',
          messages: [tooManyBagsMessage(1)],
        },
        {
          field: 'passengers.1.returnExtraBags.weightKg',
          messages: [tooHeavyMessage(1, 32)],
        },
      ]);
    });

    it('refuses return bags when the return airline sells none', async () => {
      const { service } = setup({ returnAirline: { policy: undefined } });

      expect(
        await fieldErrors(
          service.hold(
            USER_ID,
            roundTrip([
              adult('ADULT0001', { returnExtraBags: { bags: 1, weightKg: 5 } }),
            ]),
          ),
        ),
      ).toEqual([
        {
          field: 'passengers.0.returnExtraBags',
          messages: [NO_EXTRA_BAGS_MESSAGE],
        },
      ]);
    });

    it('reports a route problem and a passenger problem in one answer', async () => {
      const { service } = setup({ back: { departureAirport: 'LHR' } });

      expect(
        await fieldErrors(service.hold(USER_ID, roundTrip([infant]))),
      ).toEqual([
        {
          field: 'returnFlightId',
          messages: [returnRouteMessage('CAI', 'JFK')],
        },
        {
          field: 'passengers',
          messages: [expect.stringContaining('at least one adult')],
        },
        {
          field: 'passengers',
          messages: [expect.stringContaining('more infants')],
        },
      ]);
    });
  });

  describe('one-way bookings', () => {
    it('refuses returnExtraBags without a return flight, for each passenger who sends it', async () => {
      const { service, seatHolds } = setup();

      expect(
        await fieldErrors(
          service.hold(USER_ID, {
            flightId: OUT_ID.toString(),
            cabin: CabinClass.Economy,
            passengers: [
              adult('ADULT0001', { returnExtraBags: { bags: 1, weightKg: 5 } }),
              adult('ADULT0002'),
              adult('ADULT0003', { returnExtraBags: { bags: 1, weightKg: 5 } }),
            ],
          }),
        ),
      ).toEqual([
        {
          field: 'passengers.0.returnExtraBags',
          messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
        },
        {
          field: 'passengers.2.returnExtraBags',
          messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
        },
      ]);
      expect(seatHolds.hold).not.toHaveBeenCalled();
    });

    it('reads, holds and saves one flight and one segment, as before FLT-12', async () => {
      const { service, calls, bookings } = setup();

      await service.hold(USER_ID, {
        flightId: OUT_ID.toString(),
        cabin: CabinClass.Economy,
        passengers: [adult(), infant],
      });

      expect(calls).toEqual(['read out', 'hold out economy 1', 'create']);
      expect(saved(bookings).segments).toHaveLength(1);
      expect(saved(bookings).total).toBe(27500);
    });
  });
});

describe('FlightBookingsService.summarise: round trip (FLT-12(a))', () => {
  it('shows the return flight and totals both flights, with the prices the hold uses', async () => {
    const summarised = setup();
    const summary = await summarised.service.summarise(roundTrip());

    expect(summarised.flightResponses.toResponse).toHaveBeenCalledTimes(2);
    expect(summary.flight).toEqual({ id: OUT_ID.toString() });
    expect(summary.returnTrip).toEqual({
      flight: { id: RET_ID.toString() },
      airline: { id: RET_AIRLINE.toString(), name: 'Delta Sky', code: 'DS' },
      cabin: 'business',
      passengers: [
        { fare: 60000, extraBags: { bags: 1, weightKg: 20 }, baggageFee: 4000 },
        { fare: 6000, extraBags: null, baggageFee: 0 },
      ],
      baggage: {
        freeBags: 2,
        maxBagKg: 32,
        extraBagPrice: 4000,
        maxExtraBags: 1,
      },
      fareTotal: 66000,
      baggageTotal: 4000,
    });

    const holding = setup();
    await holding.service.hold(USER_ID, roundTrip());
    const booking = saved(holding.bookings);
    expect(summary.fareTotal).toBe(booking.fareTotal);
    expect(summary.baggageTotal).toBe(booking.baggageTotal);
    expect(summary.total).toBe(booking.total);
  });

  it('holds and saves nothing', async () => {
    const { service, seatHolds, bookings } = setup();

    await service.summarise(roundTrip());

    expect(seatHolds.hold).not.toHaveBeenCalled();
    expect(seatHolds.release).not.toHaveBeenCalled();
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('answers 409 naming the return flight when its cabin has too few seats', async () => {
    const full = cabins(30000, 60000);
    full[1].bookedSeats = 10;
    const { service } = setup({ back: { cabins: full } });

    await expect(service.summarise(roundTrip())).rejects.toThrow(
      new ConflictException(`Return flight: ${NOT_ENOUGH_SEATS_MESSAGE}`),
    );
  });

  it('checks the outbound seats first, without a prefix', async () => {
    const full = cabins(25000, 90000);
    full[0].heldSeats = 100;
    const { service } = setup({ outbound: { cabins: full } });

    await expect(service.summarise(roundTrip())).rejects.toThrow(
      new ConflictException(NOT_ENOUGH_SEATS_MESSAGE),
    );
  });

  it('shows returnTrip null for a one-way summary', async () => {
    const { service } = setup();

    const summary = await service.summarise({
      flightId: OUT_ID.toString(),
      cabin: CabinClass.Economy,
      passengers: [adult()],
    });

    expect(summary.returnTrip).toBeNull();
    expect(summary.total).toBe(25000);
  });
});

describe('returnLeavesAfterArrival (FLT-12(a))', () => {
  const arrival = { arrivalAt: new Date('2026-12-20T20:00:00.000Z') };

  it('is true only when the return leaves strictly after the outbound arrival', () => {
    expect(
      returnLeavesAfterArrival(arrival, {
        departureAt: new Date('2026-12-20T20:00:01.000Z'),
      }),
    ).toBe(true);
    expect(
      returnLeavesAfterArrival(arrival, {
        departureAt: new Date('2026-12-20T20:00:00.000Z'),
      }),
    ).toBe(false);
    expect(
      returnLeavesAfterArrival(arrival, {
        departureAt: new Date('2026-12-20T19:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('is false when a time is missing', () => {
    expect(returnLeavesAfterArrival({}, { departureAt: new Date() })).toBe(
      false,
    );
    expect(returnLeavesAfterArrival(arrival, {})).toBe(false);
  });
});

describe('forReturnFlight (FLT-12(a))', () => {
  it('prefixes a 404 and a 409 and keeps their status', () => {
    const notFound = forReturnFlight(new NotFoundException('Flight not found'));
    const conflict = forReturnFlight(new ConflictException('Not enough seats'));

    expect(notFound).toBeInstanceOf(NotFoundException);
    expect((notFound as NotFoundException).message).toBe(
      'Return flight: Flight not found',
    );
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).message).toBe(
      'Return flight: Not enough seats',
    );
  });

  it('passes any other error on unchanged', () => {
    const other = new InternalServerErrorException('boom');
    const plain = new Error('boom');

    expect(forReturnFlight(other)).toBe(other);
    expect(forReturnFlight(plain)).toBe(plain);
  });
});
