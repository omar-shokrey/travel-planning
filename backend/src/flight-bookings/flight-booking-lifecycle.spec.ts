import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  canFlightBookingMoveTo,
  FLIGHT_BOOKING_TRANSITIONS,
} from './flight-booking-lifecycle';

const ALL = Object.values(FlightBookingStatus);

describe('FLIGHT_BOOKING_TRANSITIONS (GEN-11)', () => {
  it('covers every status', () => {
    expect(Object.keys(FLIGHT_BOOKING_TRANSITIONS).sort()).toEqual(
      [...ALL].sort(),
    );
  });

  it('allows exactly the four transitions of GEN-11', () => {
    const allowed = ALL.flatMap((from) =>
      ALL.filter((to) => canFlightBookingMoveTo(from, to)).map(
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
    FlightBookingStatus.Completed,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Cancelled,
  ])('makes %s final', (status) => {
    expect(ALL.filter((to) => canFlightBookingMoveTo(status, to))).toEqual([]);
  });

  it('never skips the payment or goes back', () => {
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.PendingPayment,
        FlightBookingStatus.Completed,
      ),
    ).toBe(false);
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.PendingPayment,
        FlightBookingStatus.Cancelled,
      ),
    ).toBe(false);
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.Confirmed,
        FlightBookingStatus.PendingPayment,
      ),
    ).toBe(false);
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.Confirmed,
        FlightBookingStatus.Expired,
      ),
    ).toBe(false);
    expect(
      canFlightBookingMoveTo(
        FlightBookingStatus.Confirmed,
        FlightBookingStatus.Confirmed,
      ),
    ).toBe(false);
  });
});
