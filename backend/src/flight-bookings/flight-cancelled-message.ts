import { formatMoney } from './e-ticket/e-ticket-pdf';

/** What the notification of a flight cancelled by its airline names. */
export interface CancelledFlightText {
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  /** The departure date at the departure airport, YYYY-MM-DD. */
  departureDateLocal: string;
}

/**
 * FLT-06, GEN-01: the text of the in-app notification a passenger gets when
 * the airline cancels their flight: the flight, its local date, the booking
 * reference and the full refund. No passenger name or passport number.
 */
export function flightCancelledMessage(
  flight: CancelledFlightText,
  reference: string | undefined,
  total: number,
  currency: string,
): string {
  const booking = reference ? `Your booking ${reference}` : 'Your booking';
  return `The airline cancelled flight ${flight.flightNumber} ${flight.departureAirport} to ${flight.arrivalAirport} on ${flight.departureDateLocal}. ${booking} is cancelled and refunded in full (${formatMoney(total, currency)}).`;
}
