import { Types } from 'mongoose';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import type { HotelBookingSource } from './hotel-booking.mapper';
import { toHotelReservationResponse } from './hotel-reservation.mapper';

const id = new Types.ObjectId();
const roomId = new Types.ObjectId();

const booking = {
  _id: id,
  userId: new Types.ObjectId(),
  hotelId: new Types.ObjectId(),
  reference: 'HTL-7K2M9Q',
  checkIn: '2026-12-10',
  checkOut: '2026-12-13',
  nights: 3,
  status: HotelBookingStatus.Confirmed,
  holdExpiresAt: new Date('2026-11-17T18:10:00.000Z'),
  currency: 'USD',
  total: 37500,
  rooms: [
    {
      roomId,
      roomLabel: '101 (Double)',
      pricePerNight: 12500,
      adults: 2,
      childAges: [7],
    },
  ],
  cancellationTiers: [],
  policyAcceptedAt: new Date('2026-11-17T18:00:00.000Z'),
  createdAt: new Date('2026-11-17T18:00:00.000Z'),
  updatedAt: new Date('2026-11-17T18:00:00.000Z'),
} as HotelBookingSource;

describe('toHotelReservationResponse (HTL-22)', () => {
  it('shows the guest, dates, rooms, total and status', () => {
    expect(toHotelReservationResponse(booking, 'Sara Ahmed')).toEqual({
      id: id.toString(),
      reference: 'HTL-7K2M9Q',
      guestName: 'Sara Ahmed',
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      nights: 3,
      status: 'confirmed',
      rooms: [
        {
          roomId: roomId.toString(),
          roomLabel: '101 (Double)',
          adults: 2,
          childAges: [7],
        },
      ],
      total: 37500,
      currency: 'USD',
      createdAt: '2026-11-17T18:00:00.000Z',
    });
  });

  it("leaves out the guest's account id, the hold and the policy acceptance", () => {
    const response = toHotelReservationResponse(booking, 'Sara Ahmed');

    for (const field of [
      'userId',
      'holdExpiresAt',
      'policyAcceptedAt',
      'hotelId',
    ]) {
      expect(response).not.toHaveProperty(field);
    }
  });

  it('gives null for a missing reference or guest', () => {
    const response = toHotelReservationResponse(
      { ...booking, reference: undefined } as HotelBookingSource,
      null,
    );

    expect(response.reference).toBeNull();
    expect(response.guestName).toBeNull();
  });
});
