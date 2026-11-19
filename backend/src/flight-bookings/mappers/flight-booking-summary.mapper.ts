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

/** What the summary is built from; every value was read or computed before. */
export interface FlightBookingSummarySource {
  /** The flight as the API returns it, with its local times (GEN-06). */
  flight: FlightResponseDto;
  airline: {
    _id: Types.ObjectId;
    name: string;
    code: string;
    policy?: Pick<AirlinePolicy, 'extraBagPrice' | 'maxExtraBags'>;
  };
  cabin: { cabin: CabinClass; freeBags: number; maxBagKg: number };
  plan: Pick<PassengerPlan, 'passengers' | 'counts' | 'seats'>;
  price: BookingPrice;
}

/**
 * FLT-21: the booking summary. Pure: no database, no clock. The passengers
 * keep the order of the request, each with the fare and the bag fee of
 * `price` at the same index. No id, status, hold time, owner, seat counter
 * or Mongo internal: nothing was saved.
 */
export function toFlightBookingSummary(
  source: FlightBookingSummarySource,
): FlightBookingSummaryResponseDto {
  const { flight, airline, cabin, plan, price } = source;
  return {
    flight,
    airline: {
      id: airline._id.toString(),
      name: airline.name,
      code: airline.code,
    },
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
      extraBags: passenger.extraBags
        ? {
            bags: passenger.extraBags.bags,
            weightKg: passenger.extraBags.weightKg,
          }
        : null,
      baggageFee: price.perPassenger[index].baggageFee,
    })),
    baggage: {
      freeBags: cabin.freeBags,
      maxBagKg: cabin.maxBagKg,
      extraBagPrice: airline.policy?.extraBagPrice ?? null,
      maxExtraBags: airline.policy?.maxExtraBags ?? 0,
    },
    currency: PLATFORM_CURRENCY,
    fareTotal: price.fareTotal,
    baggageTotal: price.baggageTotal,
    total: price.total,
    priceNote: SUMMARY_PRICE_NOTE,
  };
}
