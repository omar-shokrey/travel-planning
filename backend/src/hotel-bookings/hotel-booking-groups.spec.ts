import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import {
  groupFilter,
  groupSort,
  HotelBookingGroup,
} from './hotel-booking-groups';

const TODAY = '2026-11-17';
const NOW = new Date('2026-11-17T18:00:00.000Z');

describe('groupFilter (HTL-20)', () => {
  it('upcoming: confirmed until check-out day, or waiting for payment with a live hold', () => {
    expect(groupFilter(HotelBookingGroup.Upcoming, TODAY, NOW)).toEqual({
      $or: [
        { status: HotelBookingStatus.Confirmed, checkOut: { $gte: TODAY } },
        {
          status: HotelBookingStatus.PendingPayment,
          holdExpiresAt: { $gt: NOW },
        },
      ],
    });
  });

  it('past: completed, or confirmed with check-out before today', () => {
    expect(groupFilter(HotelBookingGroup.Past, TODAY, NOW)).toEqual({
      $or: [
        { status: HotelBookingStatus.Completed },
        { status: HotelBookingStatus.Confirmed, checkOut: { $lt: TODAY } },
      ],
    });
  });

  it('cancelled: cancelled only', () => {
    expect(groupFilter(HotelBookingGroup.Cancelled, TODAY, NOW)).toEqual({
      status: HotelBookingStatus.Cancelled,
    });
  });

  it('no group: every reservation', () => {
    expect(groupFilter(undefined, TODAY, NOW)).toEqual({});
  });

  it('puts an expired reservation in no group', () => {
    const statuses = (filter: object): string[] =>
      JSON.stringify(filter).match(/"status":"(\w+)"/g) ?? [];

    for (const group of Object.values(HotelBookingGroup)) {
      expect(statuses(groupFilter(group, TODAY, NOW)).join()).not.toContain(
        HotelBookingStatus.Expired,
      );
    }
  });
});

describe('groupSort (HTL-20)', () => {
  it('shows the soonest upcoming stay first', () => {
    expect(groupSort(HotelBookingGroup.Upcoming)).toEqual({
      checkIn: 1,
      _id: 1,
    });
  });

  it('shows the latest past or cancelled stay first', () => {
    expect(groupSort(HotelBookingGroup.Past)).toEqual({ checkIn: -1, _id: -1 });
    expect(groupSort(HotelBookingGroup.Cancelled)).toEqual({
      checkIn: -1,
      _id: -1,
    });
  });

  it('shows the newest reservation first without a group', () => {
    expect(groupSort(undefined)).toEqual({ createdAt: -1, _id: -1 });
  });
});
