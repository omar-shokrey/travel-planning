import { Types } from 'mongoose';
import { FlightBookingStatus } from '../../flight-bookings/enums/flight-booking-status.enum';
import type { FlightBookingSource } from '../../flight-bookings/mappers/flight-booking.mapper';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { HotelBookingStatus } from '../../hotel-bookings/enums/hotel-booking-status.enum';
import type { HotelBookingSource } from '../../hotel-bookings/mappers/hotel-booking.mapper';
import {
  toFlightBookingPolicies,
  toHotelBookingPolicies,
} from './booking-policies.mapper';

const BOOKING_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');
const FLIGHT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const HOLD_END = new Date('2026-11-19T10:10:00.000Z');

const flightBooking = (
  fields: Partial<FlightBookingSource> = {},
  segment: Record<string, unknown> = {},
) =>
  ({
    _id: BOOKING_ID,
    userId: new Types.ObjectId(),
    status: FlightBookingStatus.PendingPayment,
    holdExpiresAt: HOLD_END,
    currency: 'USD',
    fareTotal: 50000,
    total: 50000,
    segments: [
      {
        flightId: FLIGHT_ID,
        airlineId: new Types.ObjectId(),
        cabin: CabinClass.Economy,
        fare: 25000,
        seatsReserved: 2,
        cancellationTiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 0, refundPercent: 0 },
        ],
        extraBagPrice: 4500,
        maxExtraBags: 2,
        freeBags: 1,
        maxBagKg: 23,
        ...segment,
      },
    ],
    passengerCounts: { adults: 2, children: 0, infants: 0 },
    createdAt: new Date('2026-11-19T10:00:00.000Z'),
    updatedAt: new Date('2026-11-19T10:00:00.000Z'),
    ...fields,
  }) as FlightBookingSource;

const hotelBooking = (fields: Partial<HotelBookingSource> = {}) =>
  ({
    _id: BOOKING_ID,
    userId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    checkIn: '2026-12-10',
    checkOut: '2026-12-13',
    nights: 3,
    status: HotelBookingStatus.PendingPayment,
    holdExpiresAt: HOLD_END,
    currency: 'USD',
    total: 37500,
    rooms: [],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 25 },
    ],
    createdAt: new Date('2026-11-17T18:00:00.000Z'),
    updatedAt: new Date('2026-11-17T18:00:00.000Z'),
    ...fields,
  }) as HotelBookingSource;

describe('toFlightBookingPolicies (PAY-02)', () => {
  it('shows the copied tiers in their order and the baggage rule with the currency', () => {
    expect(toFlightBookingPolicies(flightBooking())).toEqual({
      type: 'flight',
      bookingId: '6740f1c2a4b5c6d7e8f90789',
      status: 'pending_payment',
      holdExpiresAt: '2026-11-19T10:10:00.000Z',
      policyAcceptedAt: null,
      flight: {
        segments: [
          {
            flightId: '6740f1c2a4b5c6d7e8f90456',
            cabin: 'economy',
            cancellationTiers: [
              { daysBefore: 30, refundPercent: 100 },
              { daysBefore: 7, refundPercent: 50 },
              { daysBefore: 0, refundPercent: 0 },
            ],
            baggage: {
              freeBags: 1,
              maxBagKg: 23,
              extraBagPrice: 4500,
              maxExtraBags: 2,
              currency: 'USD',
            },
          },
        ],
      },
    });
  });

  it('shows a booking made before the copy with empty tiers, null allowance and no extra bags', () => {
    const response = toFlightBookingPolicies(
      flightBooking(
        {},
        {
          cancellationTiers: undefined,
          extraBagPrice: undefined,
          maxExtraBags: undefined,
          freeBags: undefined,
          maxBagKg: undefined,
        },
      ),
    );

    expect(response.flight?.segments[0]).toMatchObject({
      cancellationTiers: [],
      baggage: {
        freeBags: null,
        maxBagKg: null,
        extraBagPrice: null,
        maxExtraBags: 0,
      },
    });
  });

  it('gives the acceptance as a UTC Z string', () => {
    expect(
      toFlightBookingPolicies(
        flightBooking({
          policyAcceptedAt: new Date('2026-11-19T10:02:03.000Z'),
        }),
      ).policyAcceptedAt,
    ).toBe('2026-11-19T10:02:03.000Z');
  });

  it('shows no hold end once the booking no longer waits for payment', () => {
    expect(
      toFlightBookingPolicies(
        flightBooking({ status: FlightBookingStatus.Confirmed }),
      ).holdExpiresAt,
    ).toBeNull();
  });

  it('never returns the owner, the airline id, seat or price fields', () => {
    const response = toFlightBookingPolicies(flightBooking());

    for (const key of ['userId', '_id', 'total', 'fareTotal', 'hotel']) {
      expect(response).not.toHaveProperty(key);
    }
    const segment = response.flight?.segments[0];
    for (const key of ['airlineId', 'fare', 'seatsReserved']) {
      expect(segment).not.toHaveProperty(key);
    }
  });
});

describe('toHotelBookingPolicies (PAY-02)', () => {
  it('shows the copied times and tiers in their order', () => {
    expect(toHotelBookingPolicies(hotelBooking())).toEqual({
      type: 'hotel',
      bookingId: '6740f1c2a4b5c6d7e8f90789',
      status: 'pending_payment',
      holdExpiresAt: '2026-11-19T10:10:00.000Z',
      policyAcceptedAt: null,
      hotel: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [
          { daysBefore: 14, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 25 },
        ],
      },
    });
  });

  it('shows null times and no tiers for a hotel that set none', () => {
    expect(
      toHotelBookingPolicies(
        hotelBooking({
          checkInTime: undefined,
          checkOutTime: undefined,
          cancellationTiers: [],
        }),
      ).hotel,
    ).toEqual({ checkInTime: null, checkOutTime: null, cancellationTiers: [] });
  });

  it('never returns the owner, the hotel id or Mongo internals', () => {
    const response = toHotelBookingPolicies(hotelBooking());

    for (const key of ['userId', 'hotelId', '_id', 'rooms', 'flight']) {
      expect(response).not.toHaveProperty(key);
    }
  });
});
