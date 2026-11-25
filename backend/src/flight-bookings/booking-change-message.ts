import { formatMoney } from '../payments/refunds/refund-messages';
import { type ConfirmedLeg, legText } from './booking-confirmation-message';

/**
 * FLT-27: the text of the in-app notification of a flight change (GEN-01):
 * the reference, the new flight (number, route, local departure at its
 * airport, cabin, seats) and what happened to the price. For example "Your
 * flight booking FB-7KQ2MX was changed. Return: MS124 JFK to CAI, departs
 * 2027-06-20 09:15 JFK time, Economy, 2 seats. You paid the fare difference
 * of 42.00 USD." No passenger name or passport is in the text.
 */
export function bookingChangedMessage(
  reference: string,
  segmentIndex: number,
  leg: ConfirmedLeg,
  difference: number,
  currency: string,
): string {
  const flight = `${segmentIndex === 1 ? 'Return: ' : ''}${legText(leg)}.`;
  const money =
    difference > 0
      ? `You paid the fare difference of ${formatMoney(difference, currency)}.`
      : difference < 0
        ? `The fare difference of ${formatMoney(-difference, currency)} is being refunded to your card.`
        : 'The price did not change.';
  return `Your flight booking ${reference} was changed. ${flight} ${money}`;
}
