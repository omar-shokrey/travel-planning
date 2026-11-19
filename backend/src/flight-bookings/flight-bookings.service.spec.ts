import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AirlinesService } from '../flights/airlines.service';
import type { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import type { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  FlightBookingsService,
  fareTotalOf,
  infantFareOf,
} from './flight-bookings.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const FLIGHT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const NOW = new Date('2026-11-19T10:00:00.000Z');
const TEN_MINUTES_LATER = new Date('2026-11-19T10:10:00.000Z');

const dto = (
  passengers: Partial<HoldFlightBookingDto['passengers']> = {},
): HoldFlightBookingDto => ({
  flightId: FLIGHT_ID.toString(),
  cabin: CabinClass.Economy,
  passengers: { adults: 2, children: 1, infants: 1, ...passengers },
});

/** The flight as the seat update left it, with this economy price. */
const heldFlight = (price = 25000) => ({
  _id: FLIGHT_ID,
  airlineId: AIRLINE_ID,
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
      maxBagKg: 23,
    },
  ],
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
function setup(policy: Record<string, unknown> | null = airlinePolicy()) {
  const calls: string[] = [];
  const seatHolds = {
    hold: jest.fn(() => {
      calls.push('hold');
      return Promise.resolve(heldFlight());
    }),
    release: jest.fn(() => {
      calls.push('release');
      return Promise.resolve(true);
    }),
  };
  const bookings = {
    create: jest.fn((doc: Record<string, unknown>) => {
      calls.push('create');
      const saved = { ...doc, createdAt: NOW, updatedAt: NOW };
      return Promise.resolve({ toObject: () => saved });
    }),
  };
  const airlines = {
    findEntityOrThrow: jest.fn(() => {
      calls.push('airline');
      return Promise.resolve({ _id: AIRLINE_ID, policy: policy ?? undefined });
    }),
  };
  const service = new FlightBookingsService(
    bookings as never,
    seatHolds as unknown as FlightSeatHoldsService,
    airlines as unknown as AirlinesService,
  );
  return { service, seatHolds, bookings, airlines, calls };
}

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

describe('FlightBookingsService.hold (FLT-22)', () => {
  it('holds adults + children seats first, at one `now`, then saves the booking', async () => {
    const { service, seatHolds, calls } = setup();

    await service.hold(USER_ID, dto());

    expect(calls).toEqual(['hold', 'airline', 'create']);
    expect(seatHolds.hold).toHaveBeenCalledWith(
      FLIGHT_ID.toString(),
      CabinClass.Economy,
      3,
      NOW,
    );
  });

  it('saves a pending_payment booking held for 10 minutes, priced from the returned flight', async () => {
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
    expect(response.id).toMatch(/^[0-9a-f]{24}$/);
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('reference');
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

  it('releases the seats and rethrows when saving fails', async () => {
    const { service, seatHolds, bookings, calls } = setup();
    const failure = new Error('write failed');
    bookings.create.mockImplementationOnce(() => {
      calls.push('create');
      return Promise.reject(failure);
    });

    await expect(service.hold(USER_ID, dto())).rejects.toBe(failure);
    expect(calls).toEqual(['hold', 'airline', 'create', 'release']);
    expect(seatHolds.release).toHaveBeenCalledWith(
      FLIGHT_ID,
      CabinClass.Economy,
      3,
    );
  });

  it('still rethrows the save error when the release fails too, and logs the release', async () => {
    const { service, seatHolds, bookings } = setup();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failure = new Error('write failed');
    bookings.create.mockImplementationOnce(() => Promise.reject(failure));
    seatHolds.release.mockImplementationOnce(() =>
      Promise.reject(new Error('release failed')),
    );

    await expect(service.hold(USER_ID, dto())).rejects.toBe(failure);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('FlightBookingsService.hold copies the policy (PAY-02)', () => {
  /** The one segment the booking was saved with. */
  const savedSegment = (bookings: ReturnType<typeof setup>['bookings']) =>
    (
      bookings.create.mock.calls[0][0] as {
        segments: Record<string, unknown>[];
      }
    ).segments[0];

  it("copies the airline's tiers and extra-bag rule and the held cabin's free allowance", async () => {
    const { service, airlines, bookings } = setup();

    await service.hold(USER_ID, dto());

    expect(airlines.findEntityOrThrow).toHaveBeenCalledWith(
      AIRLINE_ID.toString(),
    );
    expect(savedSegment(bookings)).toMatchObject({
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

    expect(savedSegment(bookings).cancellationTiers).toEqual([
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

      const segment = savedSegment(bookings);
      expect(segment.cancellationTiers).toEqual([]);
      expect(segment.extraBagPrice).toBeUndefined();
      expect(segment.maxExtraBags).toBe(0);
      expect(segment).toMatchObject({ freeBags: 1, maxBagKg: 23 });
    },
  );

  it('releases the seats and rethrows when the airline cannot be read', async () => {
    const { service, seatHolds, airlines, bookings, calls } = setup();
    const missing = new NotFoundException('Airline not found');
    airlines.findEntityOrThrow.mockImplementationOnce(() => {
      calls.push('airline');
      return Promise.reject(missing);
    });

    await expect(service.hold(USER_ID, dto())).rejects.toBe(missing);
    expect(calls).toEqual(['hold', 'airline', 'release']);
    expect(bookings.create).not.toHaveBeenCalled();
    expect(seatHolds.release).toHaveBeenCalledWith(
      FLIGHT_ID,
      CabinClass.Economy,
      3,
    );
  });
});
