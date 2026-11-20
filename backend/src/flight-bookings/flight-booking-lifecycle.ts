import { FlightBookingStatus } from './enums/flight-booking-status.enum';

/**
 * GEN-11: the only status changes a flight booking may make. Pending Payment
 * -> Confirmed (payment, PAY-01) -> Completed (the trip is over), Pending
 * Payment -> Expired (hold timeout) and Confirmed -> Cancelled (user or
 * provider cancellation). Completed, Expired and Cancelled are final.
 */
export const FLIGHT_BOOKING_TRANSITIONS: Readonly<
  Record<FlightBookingStatus, readonly FlightBookingStatus[]>
> = {
  [FlightBookingStatus.PendingPayment]: [
    FlightBookingStatus.Confirmed,
    FlightBookingStatus.Expired,
  ],
  [FlightBookingStatus.Confirmed]: [
    FlightBookingStatus.Completed,
    FlightBookingStatus.Cancelled,
  ],
  [FlightBookingStatus.Completed]: [],
  [FlightBookingStatus.Expired]: [],
  [FlightBookingStatus.Cancelled]: [],
};

/** GEN-11: whether a flight booking may go from `from` to `to`. */
export const canFlightBookingMoveTo = (
  from: FlightBookingStatus,
  to: FlightBookingStatus,
): boolean => FLIGHT_BOOKING_TRANSITIONS[from].includes(to);
