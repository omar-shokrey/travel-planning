import { Types } from 'mongoose';
import { RefundStatus } from '../../payments/refunds/enums/refund-status.enum';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import { ReservationGroup } from '../enums/reservation-group.enum';
import type { HotelBookingSource } from './hotel-booking.mapper';
import {
  toHotelReservationDetails,
  toHotelReservationListItem,
} from './hotel-reservation.mapper';

const BOOKING_ID = new Types.ObjectId();
const HOTEL_ID = new Types.ObjectId();
const ROOM_A = new Types.ObjectId();
const ROOM_B = new Types.ObjectId();

const stored = (fields: Partial<HotelBookingSource> = {}): HotelBookingSource =>
  ({
    _id: BOOKING_ID,
    reference: 'HB-7KQ2MX',
    userId: new Types.ObjectId(),
    hotelId: HOTEL_ID,
    checkIn: '2027-06-15',
    checkOut: '2027-06-18',
    nights: 3,
    status: HotelBookingStatus.Confirmed,
    holdExpiresAt: new Date('2027-06-01T10:10:00.000Z'),
    policyAcceptedAt: new Date('2027-06-01T10:05:00.000Z'),
    currency: 'USD',
    total: 97500,
    rooms: [
      {
        roomId: ROOM_A,
        roomLabel: '101 (Double)',
        pricePerNight: 12500,
        adults: 2,
        childAges: [],
      },
      {
        roomId: ROOM_B,
        roomLabel: '102 (Family)',
        pricePerNight: 20000,
        adults: 1,
        childAges: [7, 3],
      },
    ],
    checkInTime: '14:00',
    cancellationTiers: [
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 14, refundPercent: 100 },
    ],
    createdAt: new Date('2027-06-01T10:00:00.000Z'),
    updatedAt: new Date('2027-06-01T10:06:00.000Z'),
    ...fields,
  }) as HotelBookingSource;

describe('toHotelReservationListItem (HTL-20)', () => {
  it('shows the reference, the hotel, the rooms, the dates, the guests, the total, the status and the group', () => {
    expect(
      toHotelReservationListItem(
        stored(),
        'Nile Hotel',
        ReservationGroup.Upcoming,
      ),
    ).toEqual({
      id: BOOKING_ID.toString(),
      reference: 'HB-7KQ2MX',
      hotel: { id: HOTEL_ID.toString(), name: 'Nile Hotel' },
      rooms: [
        { roomLabel: '101 (Double)', adults: 2, childAges: [] },
        { roomLabel: '102 (Family)', adults: 1, childAges: [7, 3] },
      ],
      checkIn: '2027-06-15',
      checkOut: '2027-06-18',
      nights: 3,
      guests: { adults: 3, children: 2 },
      total: 97500,
      currency: 'USD',
      status: HotelBookingStatus.Confirmed,
      group: ReservationGroup.Upcoming,
    });
  });

  it('shows a null name for a hotel that no longer exists, and never the hold or the owner', () => {
    const item = toHotelReservationListItem(
      stored(),
      undefined,
      ReservationGroup.Past,
    );

    expect(item.hotel).toEqual({ id: HOTEL_ID.toString(), name: null });
    const text = JSON.stringify(item);
    expect(text).not.toContain('holdExpiresAt');
    expect(text).not.toContain('policyAcceptedAt');
    expect(text).not.toContain('userId');
  });
});

describe('toHotelReservationDetails (HTL-20)', () => {
  const refund = {
    id: 'refund-1',
    status: RefundStatus.Pending,
    amount: 48750,
    currency: 'USD',
    refundPercent: 50,
  };

  it('shows everything the owner needs, with the group of today, the tiers in order and the refund', () => {
    const details = toHotelReservationDetails(
      stored({ status: HotelBookingStatus.Cancelled }),
      'Nile Hotel',
      refund,
      '2027-06-10',
    );

    expect(details).toEqual({
      id: BOOKING_ID.toString(),
      reference: 'HB-7KQ2MX',
      hotel: { id: HOTEL_ID.toString(), name: 'Nile Hotel' },
      status: HotelBookingStatus.Cancelled,
      group: ReservationGroup.Cancelled,
      checkIn: '2027-06-15',
      checkOut: '2027-06-18',
      nights: 3,
      checkInTime: '14:00',
      checkOutTime: null,
      rooms: [
        {
          roomId: ROOM_A.toString(),
          roomLabel: '101 (Double)',
          pricePerNight: 12500,
          subtotal: 37500,
          adults: 2,
          childAges: [],
        },
        {
          roomId: ROOM_B.toString(),
          roomLabel: '102 (Family)',
          pricePerNight: 20000,
          subtotal: 60000,
          adults: 1,
          childAges: [7, 3],
        },
      ],
      guests: { adults: 3, children: 2 },
      total: 97500,
      currency: 'USD',
      cancellationTiers: [
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
      refund,
      createdAt: '2027-06-01T10:00:00.000Z',
    });
  });

  it('has no group while the reservation waits for payment, no refund when there is none, and never the hold', () => {
    const details = toHotelReservationDetails(
      stored({
        status: HotelBookingStatus.PendingPayment,
        reference: undefined,
      }),
      'Nile Hotel',
      null,
      '2027-06-10',
    );

    expect(details.group).toBeNull();
    expect(details.reference).toBeNull();
    expect(details.refund).toBeNull();
    const text = JSON.stringify(details);
    expect(text).not.toContain('holdExpiresAt');
    expect(text).not.toContain('policyAcceptedAt');
    expect(text).not.toContain('userId');
  });
});
