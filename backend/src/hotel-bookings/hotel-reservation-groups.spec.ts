import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReservationGroup } from './enums/reservation-group.enum';
import {
  groupFilter,
  groupOf,
  groupSort,
  LISTED_STATUSES,
} from './hotel-reservation-groups';

const TODAY = '2027-06-15';

/** Whether a stored reservation matches a filter of `groupFilter` (the operators it uses). */
function matches(
  filter: Record<string, unknown>,
  booking: { status: HotelBookingStatus; checkOut: string },
): boolean {
  if (Array.isArray(filter.$or)) {
    return (filter.$or as Record<string, unknown>[]).some((part) =>
      matches(part, booking),
    );
  }
  const status = filter.status as HotelBookingStatus | { $in: string[] };
  const statusOk =
    typeof status === 'string'
      ? booking.status === status
      : status.$in.includes(booking.status);
  const checkOut = filter.checkOut as
    { $gte?: string; $lt?: string } | undefined;
  const checkOutOk =
    !checkOut ||
    ((checkOut.$gte === undefined || booking.checkOut >= checkOut.$gte) &&
      (checkOut.$lt === undefined || booking.checkOut < checkOut.$lt));
  return statusOk && checkOutOk;
}

describe('groupOf (HTL-20)', () => {
  it.each([
    [HotelBookingStatus.Cancelled, '2027-07-01', ReservationGroup.Cancelled],
    [HotelBookingStatus.Cancelled, '2027-01-01', ReservationGroup.Cancelled],
    [HotelBookingStatus.Completed, '2027-06-10', ReservationGroup.Past],
    [HotelBookingStatus.Confirmed, '2027-06-14', ReservationGroup.Past],
    [HotelBookingStatus.Confirmed, '2027-06-15', ReservationGroup.Upcoming],
    [HotelBookingStatus.Confirmed, '2027-07-01', ReservationGroup.Upcoming],
    [HotelBookingStatus.PendingPayment, '2027-07-01', null],
    [HotelBookingStatus.Expired, '2027-07-01', null],
  ])(
    'puts a %s reservation that checks out on %s in %p',
    (status, checkOut, group) => {
      expect(groupOf({ status, checkOut }, TODAY)).toBe(group);
    },
  );
});

describe('groupFilter (HTL-20)', () => {
  const samples = Object.values(HotelBookingStatus).flatMap((status) =>
    ['2027-06-14', '2027-06-15', '2027-06-16'].map((checkOut) => ({
      status,
      checkOut,
    })),
  );

  it.each(Object.values(ReservationGroup))(
    'finds exactly the reservations that groupOf puts in %s',
    (group) => {
      for (const booking of samples) {
        expect(matches(groupFilter(group, TODAY), booking)).toBe(
          groupOf(booking, TODAY) === group,
        );
      }
    },
  );

  it('lists every reservation that is in a group when no group is asked, and no other', () => {
    for (const booking of samples) {
      expect(matches(groupFilter(undefined, TODAY), booking)).toBe(
        groupOf(booking, TODAY) !== null,
      );
    }
    expect(LISTED_STATUSES).not.toContain(HotelBookingStatus.PendingPayment);
    expect(LISTED_STATUSES).not.toContain(HotelBookingStatus.Expired);
  });
});

describe('groupSort (HTL-20)', () => {
  it('lists Upcoming soonest first, the others most recent first, with _id breaking ties', () => {
    expect(groupSort(ReservationGroup.Upcoming)).toEqual({
      checkIn: 1,
      _id: 1,
    });
    expect(groupSort(ReservationGroup.Past)).toEqual({ checkOut: -1, _id: -1 });
    expect(groupSort(ReservationGroup.Cancelled)).toEqual({
      checkIn: -1,
      _id: -1,
    });
    expect(groupSort(undefined)).toEqual({ checkIn: -1, _id: -1 });
  });
});
