import { HotelBookingStatus } from './enums/hotel-booking-status.enum';

/**
 * GEN-11: the only status changes a hotel reservation may make. Pending Payment
 * -> Confirmed (payment, PAY-01) -> Completed (the trip is over), Pending
 * Payment -> Expired (hold timeout) and Confirmed -> Cancelled (user or
 * provider cancellation). Completed, Expired and Cancelled are final.
 */
export const HOTEL_BOOKING_TRANSITIONS: Readonly<
  Record<HotelBookingStatus, readonly HotelBookingStatus[]>
> = {
  [HotelBookingStatus.PendingPayment]: [
    HotelBookingStatus.Confirmed,
    HotelBookingStatus.Expired,
  ],
  [HotelBookingStatus.Confirmed]: [
    HotelBookingStatus.Completed,
    HotelBookingStatus.Cancelled,
  ],
  [HotelBookingStatus.Completed]: [],
  [HotelBookingStatus.Expired]: [],
  [HotelBookingStatus.Cancelled]: [],
};

/** GEN-11: whether a hotel reservation may go from `from` to `to`. */
export const canHotelBookingMoveTo = (
  from: HotelBookingStatus,
  to: HotelBookingStatus,
): boolean => HOTEL_BOOKING_TRANSITIONS[from].includes(to);
