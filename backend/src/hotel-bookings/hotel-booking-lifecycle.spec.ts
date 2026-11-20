import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import {
  canHotelBookingMoveTo,
  HOTEL_BOOKING_TRANSITIONS,
} from './hotel-booking-lifecycle';

const ALL = Object.values(HotelBookingStatus);

describe('HOTEL_BOOKING_TRANSITIONS (GEN-11)', () => {
  it('covers every status', () => {
    expect(Object.keys(HOTEL_BOOKING_TRANSITIONS).sort()).toEqual(
      [...ALL].sort(),
    );
  });

  it('allows exactly the four transitions of GEN-11', () => {
    const allowed = ALL.flatMap((from) =>
      ALL.filter((to) => canHotelBookingMoveTo(from, to)).map(
        (to) => `${from} -> ${to}`,
      ),
    );

    expect(allowed.sort()).toEqual(
      [
        'pending_payment -> confirmed',
        'pending_payment -> expired',
        'confirmed -> completed',
        'confirmed -> cancelled',
      ].sort(),
    );
  });

  it.each([
    HotelBookingStatus.Completed,
    HotelBookingStatus.Expired,
    HotelBookingStatus.Cancelled,
  ])('makes %s final', (status) => {
    expect(ALL.filter((to) => canHotelBookingMoveTo(status, to))).toEqual([]);
  });

  it('never skips the payment or goes back', () => {
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.PendingPayment,
        HotelBookingStatus.Completed,
      ),
    ).toBe(false);
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.PendingPayment,
        HotelBookingStatus.Cancelled,
      ),
    ).toBe(false);
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.Confirmed,
        HotelBookingStatus.PendingPayment,
      ),
    ).toBe(false);
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.Confirmed,
        HotelBookingStatus.Expired,
      ),
    ).toBe(false);
    expect(
      canHotelBookingMoveTo(
        HotelBookingStatus.Confirmed,
        HotelBookingStatus.Confirmed,
      ),
    ).toBe(false);
  });
});
