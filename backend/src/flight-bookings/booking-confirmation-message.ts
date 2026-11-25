import { CabinClass } from '../flights/models/cabin-class.enum';

/** The name of a cabin as a passenger reads it. */
export const CABIN_LABELS: Record<CabinClass, string> = {
  [CabinClass.Economy]: 'Economy',
  [CabinClass.PremiumEconomy]: 'Premium economy',
  [CabinClass.Business]: 'Business',
  [CabinClass.First]: 'First',
};

/** One flight of a confirmed booking, as the message shows it. */
export interface ConfirmedLeg {
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  /** The departure in the departure airport's time zone, `YYYY-MM-DDTHH:mm` (GEN-06). */
  departureLocal: string;
  cabin: CabinClass;
  /** Adults and children: infants occupy no seat. */
  seats: number;
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

export const legText = (leg: ConfirmedLeg): string =>
  `${leg.flightNumber} ${leg.departureAirport} to ${leg.arrivalAirport}, departs ${leg.departureLocal.replace('T', ' ')} ${leg.departureAirport} time, ${CABIN_LABELS[leg.cabin]}, ${plural(leg.seats, 'seat')}`;

/**
 * FLT-23: the text of the in-app notification of a confirmed booking
 * (GEN-01): the reference, and for each flight the number, the route, the
 * local departure time at its airport, the cabin and the seats. For example
 * "Your flight booking FB-7KQ2MX is confirmed. MS123 CAI to JFK, departs
 * 2027-06-15 14:30 CAI time, Economy, 2 seats." A round trip adds "Return:"
 * and its flight; infants are named because they occupy no seat. No
 * passenger name or passport is in the text.
 */
export function bookingConfirmedMessage(
  reference: string,
  legs: readonly ConfirmedLeg[],
  infants: number,
): string {
  const [outbound, ...rest] = legs;
  const parts = [
    `Your flight booking ${reference} is confirmed.`,
    `${legText(outbound)}.`,
    ...rest.map((leg) => `Return: ${legText(leg)}.`),
  ];
  if (infants > 0) {
    parts.push(`Plus ${plural(infants, 'infant')} on a lap (no seat).`);
  }
  return parts.join(' ');
}
