import { Types } from 'mongoose';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import {
  toHotelBookingResponse,
  type HotelBookingSource,
} from './hotel-booking.mapper';

const id = new Types.ObjectId();
const userId = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const roomA = new Types.ObjectId();
const roomB = new Types.ObjectId();

const booking = (fields: Partial<HotelBookingSource> = {}) =>
  ({
    _id: id,
    userId,
    hotelId,
    checkIn: '2026-12-10',
    checkOut: '2026-12-13',
    nights: 3,
    status: HotelBookingStatus.PendingPayment,
    holdExpiresAt: new Date('2026-11-17T18:10:00.000Z'),
    currency: 'USD',
    total: 67500,
    rooms: [
      {
        roomId: roomA,
        roomLabel: '101 (Double)',
        pricePerNight: 12500,
        adults: 2,
        childAges: [7],
      },
      {
        roomId: roomB,
        roomLabel: '102 (Single)',
        pricePerNight: 10000,
        adults: 1,
        childAges: [],
      },
    ],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
    ],
    policyAcceptedAt: new Date('2026-11-17T18:00:00.000Z'),
    createdAt: new Date('2026-11-17T18:00:00.000Z'),
    updatedAt: new Date('2026-11-17T18:00:00.000Z'),
    ...fields,
  }) as HotelBookingSource;

describe('toHotelBookingResponse (HTL-16, HTL-18)', () => {
  it('returns the public fields, with ids as strings and moments in UTC', () => {
    expect(toHotelBookingResponse(booking())).toEqual({
      id: id.toString(),
      reference: null,
      hotelId: hotelId.toString(),
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      nights: 3,
      status: 'pending_payment',
      holdExpiresAt: '2026-11-17T18:10:00.000Z',
      currency: 'USD',
      total: 67500,
      rooms: [
        {
          roomId: roomA.toString(),
          roomLabel: '101 (Double)',
          pricePerNight: 12500,
          subtotal: 37500,
          adults: 2,
          childAges: [7],
        },
        {
          roomId: roomB.toString(),
          roomLabel: '102 (Single)',
          pricePerNight: 10000,
          subtotal: 30000,
          adults: 1,
          childAges: [],
        },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ],
      policyAcceptedAt: '2026-11-17T18:00:00.000Z',
      createdAt: '2026-11-17T18:00:00.000Z',
    });
  });

  it('never returns the owner or internal fields', () => {
    const response = toHotelBookingResponse(booking());

    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('updatedAt');
  });

  it('gives null for what the reservation does not have', () => {
    const response = toHotelBookingResponse(
      booking({
        holdExpiresAt: undefined,
        checkInTime: undefined,
        checkOutTime: undefined,
      }),
    );

    expect(response.holdExpiresAt).toBeNull();
    expect(response.checkInTime).toBeNull();
    expect(response.checkOutTime).toBeNull();
  });

  it('returns the reference once there is one', () => {
    expect(
      toHotelBookingResponse(booking({ reference: 'HTL-7K2M9Q' })).reference,
    ).toBe('HTL-7K2M9Q');
  });
});
