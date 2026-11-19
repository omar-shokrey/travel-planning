import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import type { AirlinePolicy } from '../../flights/models/airline-policy.schema';
import type { CabinClass } from '../../flights/models/cabin-class.enum';
import type { PassengerPlan } from '../booking-passengers';
import type { BookingPrice } from '../booking-price';
import {
  type FlightBookingSummaryResponseDto,
  SUMMARY_PRICE_NOTE,
} from '../dto/flight-booking-summary-response.dto';

/** One flight of the summary; every value was read or computed before. */
export interface SummaryLegSource {
  /** The flight as the API returns it, with its local times (GEN-06). */
  flight: FlightResponseDto;
  airline: {
    _id: Types.ObjectId;
    name: string;
    code: string;
    policy?: Pick<AirlinePolicy, 'extraBagPrice' | 'maxExtraBags'>;
  };
  cabin: { cabin: CabinClass; freeBags: number; maxBagKg: number };
  /** What each passenger has on this flight, in the order of the request. */
  passengers: readonly { extraBags?: { bags: number; weightKg: number } }[];
  /** The price of this flight for every passenger. */
  price: BookingPrice;
}

/** What the summary is built from: the outbound flight and, FLT-12(a), the return. */
export interface FlightBookingSummarySource extends SummaryLegSource {
  plan: Pick<PassengerPlan, 'passengers' | 'counts' | 'seats'>;
  /** FLT-12(a): the return flight of a round trip; `null` one-way. */
  returnTrip: SummaryLegSource | null;
}

const airlineOf = (airline: SummaryLegSource['airline']) => ({
  id: airline._id.toString(),
  name: airline.name,
  code: airline.code,
});

const baggageOf = ({ cabin, airline }: SummaryLegSource) => ({
  freeBags: cabin.freeBags,
  maxBagKg: cabin.maxBagKg,
  extraBagPrice: airline.policy?.extraBagPrice ?? null,
  maxExtraBags: airline.policy?.maxExtraBags ?? 0,
});

const bagsOf = (bags: { bags: number; weightKg: number } | undefined) =>
  bags ? { bags: bags.bags, weightKg: bags.weightKg } : null;

/**
 * FLT-21: the booking summary. Pure: no database, no clock. The passengers
 * keep the order of the request, each with the fare and the bag fee of
 * `price` at the same index. No id, status, hold time, owner, seat counter
 * or Mongo internal: nothing was saved.
 *
 * FLT-12(a): the top-level flight, airline, cabin, passengers' fares and bags
 * and baggage are the outbound flight's; `returnTrip` has the same for the
 * return flight (or is `null`); `fareTotal`, `baggageTotal` and `total` cover
 * both flights, as the hold will charge.
 */
export function toFlightBookingSummary(
  source: FlightBookingSummarySource,
): FlightBookingSummaryResponseDto {
  const { flight, airline, cabin, plan, price, returnTrip } = source;
  const prices = [price, ...(returnTrip ? [returnTrip.price] : [])];
  const fareTotal = prices.reduce((sum, leg) => sum + leg.fareTotal, 0);
  const baggageTotal = prices.reduce((sum, leg) => sum + leg.baggageTotal, 0);
  return {
    flight,
    airline: airlineOf(airline),
    cabin: cabin.cabin,
    seats: plan.seats,
    passengerCounts: {
      adults: plan.counts.adults,
      children: plan.counts.children,
      infants: plan.counts.infants,
    },
    passengers: plan.passengers.map((passenger, index) => ({
      fullName: passenger.fullName,
      dateOfBirth: passenger.dateOfBirth,
      type: passenger.type,
      passportNumber: passenger.passportNumber,
      fare: price.perPassenger[index].fare,
      extraBags: bagsOf(passenger.extraBags),
      baggageFee: price.perPassenger[index].baggageFee,
    })),
    baggage: baggageOf(source),
    returnTrip: returnTrip
      ? {
          flight: returnTrip.flight,
          airline: airlineOf(returnTrip.airline),
          cabin: returnTrip.cabin.cabin,
          passengers: returnTrip.passengers.map((passenger, index) => ({
            fare: returnTrip.price.perPassenger[index].fare,
            extraBags: bagsOf(passenger.extraBags),
            baggageFee: returnTrip.price.perPassenger[index].baggageFee,
          })),
          baggage: baggageOf(returnTrip),
          fareTotal: returnTrip.price.fareTotal,
          baggageTotal: returnTrip.price.baggageTotal,
        }
      : null,
    currency: PLATFORM_CURRENCY,
    fareTotal,
    baggageTotal,
    total: fareTotal + baggageTotal,
    priceNote: SUMMARY_PRICE_NOTE,
  };
}
