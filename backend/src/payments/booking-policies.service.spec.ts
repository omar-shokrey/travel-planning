import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';
import type { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { HotelBookingStatus } from '../hotel-bookings/enums/hotel-booking-status.enum';
import type { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { BookingPoliciesService } from './booking-policies.service';
import { BookingType } from './enums/booking-type.enum';
import {
  BOOKING_CHANGED_MESSAGE,
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from './payments.constants';

const ID = '6740f1c2a4b5c6d7e8f90789';
const USER = '6740f1c2a4b5c6d7e8f90123';
const NOW = new Date('2026-11-19T10:05:00.000Z');
const HOLD_END = new Date('2026-11-19T10:10:00.000Z');
const FIRST_ACCEPTANCE = new Date('2026-11-19T10:01:00.000Z');

const flight = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(ID),
  status: FlightBookingStatus.PendingPayment,
  holdExpiresAt: HOLD_END,
  currency: 'USD',
  total: 52500,
  segments: [
    {
      flightId: new Types.ObjectId(),
      airlineId: new Types.ObjectId(),
      cabin: CabinClass.Economy,
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      maxExtraBags: 0,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  ...fields,
});

const hotel = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(ID),
  status: HotelBookingStatus.PendingPayment,
  holdExpiresAt: HOLD_END,
  currency: 'USD',
  total: 37500,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [],
  ...fields,
});

const notFound = () =>
  Promise.reject(new NotFoundException('Booking not found'));

/** Fake booking services: `owned` is what the owner lookup finds, `accepted` what the conditional update returns. */
function setup(owned: {
  flight?: unknown;
  hotel?: unknown;
  acceptedFlight?: unknown;
  acceptedHotel?: unknown;
}) {
  const flightBookings = {
    findOwnedEntityOrThrow: jest.fn(() =>
      owned.flight ? Promise.resolve(owned.flight) : notFound(),
    ),
    acceptPolicies: jest.fn(() =>
      Promise.resolve(owned.acceptedFlight ?? null),
    ),
  };
  const hotelBookings = {
    findOwnedEntityOrThrow: jest.fn(() =>
      owned.hotel ? Promise.resolve(owned.hotel) : notFound(),
    ),
    acceptPolicies: jest.fn(() => Promise.resolve(owned.acceptedHotel ?? null)),
  };
  const service = new BookingPoliciesService(
    flightBookings as unknown as FlightBookingsService,
    hotelBookings as unknown as HotelBookingsService,
  );
  return { service, flightBookings, hotelBookings };
}

async function failureOf(call: Promise<unknown>): Promise<Error> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BookingPoliciesService.findPolicies (PAY-02)', () => {
  it("shows a flight booking's copied policies", async () => {
    const { service, flightBookings, hotelBookings } = setup({
      flight: flight(),
    });

    const response = await service.findPolicies(BookingType.Flight, ID, USER);

    expect(flightBookings.findOwnedEntityOrThrow).toHaveBeenCalledWith(
      ID,
      USER,
    );
    expect(hotelBookings.findOwnedEntityOrThrow).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      type: 'flight',
      bookingId: ID,
      policyAcceptedAt: null,
      flight: {
        segments: [
          { cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }] },
        ],
      },
    });
  });

  it("shows a hotel reservation's copied policies", async () => {
    const { service, hotelBookings } = setup({ hotel: hotel() });

    const response = await service.findPolicies(BookingType.Hotel, ID, USER);

    expect(hotelBookings.findOwnedEntityOrThrow).toHaveBeenCalledWith(ID, USER);
    expect(response.hotel).toEqual({
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [],
    });
  });

  it('shows the policies in any status', async () => {
    const { service } = setup({
      flight: flight({ status: FlightBookingStatus.Expired }),
    });

    await expect(
      service.findPolicies(BookingType.Flight, ID, USER),
    ).resolves.toMatchObject({ status: 'expired', holdExpiresAt: null });
  });

  it("answers 404 for someone else's booking", async () => {
    const { service } = setup({});

    expect(
      await failureOf(service.findPolicies(BookingType.Hotel, ID, USER)),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('BookingPoliciesService.acceptPolicies (PAY-02)', () => {
  it.each([
    [BookingType.Flight, 'flightBookings', flight] as const,
    [BookingType.Hotel, 'hotelBookings', hotel] as const,
  ])(
    'accepts a %s booking with one conditional update at one `now`',
    async (type, owner, booking) => {
      const accepted = booking({ policyAcceptedAt: NOW });
      const fakes = setup({
        acceptedFlight: accepted,
        acceptedHotel: accepted,
      });

      const response = await fakes.service.acceptPolicies(type, ID, USER);

      expect(fakes[owner].acceptPolicies).toHaveBeenCalledWith(ID, USER, NOW);
      expect(fakes[owner].findOwnedEntityOrThrow).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        type,
        policyAcceptedAt: '2026-11-19T10:05:00.000Z',
      });
    },
  );

  it('answers 200 with the first timestamp when it was already accepted', async () => {
    const { service } = setup({
      flight: flight({ policyAcceptedAt: FIRST_ACCEPTANCE }),
    });

    await expect(
      service.acceptPolicies(BookingType.Flight, ID, USER),
    ).resolves.toMatchObject({
      policyAcceptedAt: '2026-11-19T10:01:00.000Z',
    });
  });

  it('keeps the first timestamp even after the hold ended', async () => {
    const { service } = setup({
      hotel: hotel({
        policyAcceptedAt: FIRST_ACCEPTANCE,
        holdExpiresAt: new Date('2026-11-19T10:04:00.000Z'),
      }),
    });

    await expect(
      service.acceptPolicies(BookingType.Hotel, ID, USER),
    ).resolves.toMatchObject({
      policyAcceptedAt: '2026-11-19T10:01:00.000Z',
    });
  });

  it.each([
    ['ended before now', new Date('2026-11-19T10:04:59.999Z')],
    ['ending exactly now', NOW],
  ])('answers 409 for a hold %s', async (_label, holdExpiresAt) => {
    const { service } = setup({ flight: flight({ holdExpiresAt }) });

    const error = await failureOf(
      service.acceptPolicies(BookingType.Flight, ID, USER),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(HOLD_EXPIRED_MESSAGE);
  });

  it.each([
    HotelBookingStatus.Confirmed,
    HotelBookingStatus.Expired,
    HotelBookingStatus.Cancelled,
  ])('answers 409 for a %s booking', async (status) => {
    const { service } = setup({ hotel: hotel({ status }) });

    const error = await failureOf(
      service.acceptPolicies(BookingType.Hotel, ID, USER),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(NOT_WAITING_FOR_PAYMENT_MESSAGE);
  });

  it("answers 404 for someone else's booking", async () => {
    const { service } = setup({});

    const error = await failureOf(
      service.acceptPolicies(BookingType.Flight, ID, USER),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Booking not found');
  });

  it('answers 409 "try again" when the booking changed between the update and the read', async () => {
    const { service } = setup({ flight: flight() });

    const error = await failureOf(
      service.acceptPolicies(BookingType.Flight, ID, USER),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(BOOKING_CHANGED_MESSAGE);
  });
});

describe('BookingPoliciesService.findPayableOrThrow (PAY-02, for PAY-01)', () => {
  it('gives the amount of an accepted booking with a live hold', async () => {
    const { service } = setup({
      flight: flight({ policyAcceptedAt: FIRST_ACCEPTANCE }),
    });

    await expect(
      service.findPayableOrThrow(BookingType.Flight, ID, USER, NOW),
    ).resolves.toEqual({
      type: 'flight',
      bookingId: ID,
      total: 52500,
      currency: 'USD',
      holdExpiresAt: HOLD_END,
    });
  });

  it('blocks payment until the policies are accepted', async () => {
    const { service } = setup({ hotel: hotel() });

    const error = await failureOf(
      service.findPayableOrThrow(BookingType.Hotel, ID, USER, NOW),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(POLICIES_NOT_ACCEPTED_MESSAGE);
  });

  it('blocks payment when the hold has ended, even if accepted', async () => {
    const { service } = setup({
      hotel: hotel({ policyAcceptedAt: FIRST_ACCEPTANCE }),
    });

    const error = await failureOf(
      service.findPayableOrThrow(BookingType.Hotel, ID, USER, HOLD_END),
    );

    expect(error.message).toBe(HOLD_EXPIRED_MESSAGE);
  });

  it('blocks payment of a booking that is not waiting for payment', async () => {
    const { service } = setup({
      flight: flight({
        status: FlightBookingStatus.Confirmed,
        policyAcceptedAt: FIRST_ACCEPTANCE,
      }),
    });

    const error = await failureOf(
      service.findPayableOrThrow(BookingType.Flight, ID, USER, NOW),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(NOT_WAITING_FOR_PAYMENT_MESSAGE);
  });

  it("answers 404 for someone else's booking", async () => {
    const { service } = setup({});

    expect(
      await failureOf(
        service.findPayableOrThrow(BookingType.Flight, ID, USER, NOW),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});
