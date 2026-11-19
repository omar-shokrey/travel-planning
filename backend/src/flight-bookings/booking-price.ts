import type { PassengerPlan, PlannedPassenger } from './booking-passengers';
import { PassengerType } from './enums/passenger-type.enum';
import { INFANT_FARE_PERCENT } from './flight-bookings.constants';

/** FLT-12: an infant pays 10% of the fare, rounded to a whole minor unit. */
export const infantFareOf = (fare: number): number =>
  Math.round((fare * INFANT_FARE_PERCENT) / 100);

/** Every seat at the full fare, every infant at the infant fare: whole minor units. */
export const fareTotalOf = (
  fare: number,
  seats: number,
  infants: number,
): number => fare * seats + infants * infantFareOf(fare);

/** What one passenger pays, in the order of the request. */
export interface PassengerPrice {
  /** The seat fare, or the infant fare (10%, rounded) for an infant. */
  fare: number;
  /** Bags × the airline's extra bag price; 0 without extra bags (FLT-19). */
  baggageFee: number;
}

export interface BookingPrice {
  fareTotal: number;
  baggageTotal: number;
  /** `fareTotal + baggageTotal`. */
  total: number;
  perPassenger: PassengerPrice[];
}

/**
 * FLT-21: the one price of a booking, used by the hold (FLT-22, with the fare
 * of the flight the hold returned) and by the summary (with the cabin price it
 * read), so both always give the same totals for the same fare and passengers.
 * Adults and children pay the fare, infants 10% of it rounded (FLT-12), and
 * each passenger adds their extra-bag fee (FLT-19). Every amount is a whole
 * number of minor units of the platform currency.
 */
export function priceBooking(
  fare: number,
  plan: Pick<PassengerPlan, 'seats' | 'counts'> & {
    /** What each passenger has on this flight: their type and bag fee. */
    passengers: readonly Pick<PlannedPassenger, 'type' | 'baggageFee'>[];
  },
): BookingPrice {
  const infantFare = infantFareOf(fare);
  const perPassenger = plan.passengers.map((passenger) => ({
    fare: passenger.type === PassengerType.Infant ? infantFare : fare,
    baggageFee: passenger.baggageFee,
  }));
  const fareTotal = fareTotalOf(fare, plan.seats, plan.counts.infants);
  const baggageTotal = perPassenger.reduce(
    (sum, { baggageFee }) => sum + baggageFee,
    0,
  );
  return {
    fareTotal,
    baggageTotal,
    total: fareTotal + baggageTotal,
    perPassenger,
  };
}
