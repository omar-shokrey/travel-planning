import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';

/**
 * The five booking statuses (GEN-11), as plain values. Flight bookings and
 * hotel reservations use the same five values (a unit test checks that the
 * two enums stay equal), so the admin list (ACC-17) filters both with one set.
 */
export const ADMIN_BOOKING_STATUSES = Object.values(FlightBookingStatus);

/** One of the five booking statuses, for a flight or a hotel booking. */
export type AdminBookingStatus = `${FlightBookingStatus}`;

/** The 400 message when `from` is after `to` in the admin booking list. */
export const BOOKING_RANGE_ORDER_MESSAGE = 'from must be on or before to';

/**
 * The name shown for a provider (airline or hotel) whose record cannot be
 * found any more, so the row still lists the provider's id.
 */
export const UNKNOWN_PROVIDER_NAME = '(unknown)';

/** The name and email shown for an account that cannot be found any more. */
export const UNKNOWN_USER_NAME = '(unknown)';
