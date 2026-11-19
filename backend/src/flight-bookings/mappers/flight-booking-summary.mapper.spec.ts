import { Types } from 'mongoose';
import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { SUMMARY_PRICE_NOTE } from '../dto/flight-booking-summary-response.dto';
import { PassengerType } from '../enums/passenger-type.enum';
import {
  type FlightBookingSummarySource,
  toFlightBookingSummary,
} from './flight-booking-summary.mapper';

const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90999');
const FLIGHT = { id: '6740f1c2a4b5c6d7e8f90456' } as FlightResponseDto;

const PLAN: FlightBookingSummarySource['plan'] = {
  passengers: [
    {
      fullName: 'Sara Ahmed',
      dateOfBirth: '1990-05-14',
      passportNumber: 'A12345678',
      type: PassengerType.Adult,
      extraBags: { bags: 2, weightKg: 40 },
      baggageFee: 9000,
    },
    {
      fullName: 'Baby Ahmed',
      dateOfBirth: '2026-03-01',
      passportNumber: 'C12345678',
      type: PassengerType.Infant,
      baggageFee: 0,
    },
  ],
  counts: { adults: 1, children: 0, infants: 1 },
  seats: 1,
};

const source = (
  fields: Partial<FlightBookingSummarySource> = {},
): FlightBookingSummarySource => ({
  flight: FLIGHT,
  airline: {
    _id: AIRLINE_ID,
    name: 'Nile Air',
    code: 'NP',
    policy: { extraBagPrice: 4500, maxExtraBags: 2 },
  },
  cabin: { cabin: CabinClass.Economy, freeBags: 1, maxBagKg: 23 },
  plan: PLAN,
  passengers: PLAN.passengers,
  returnTrip: null,
  price: {
    fareTotal: 27500,
    baggageTotal: 9000,
    total: 36500,
    perPassenger: [
      { fare: 25000, baggageFee: 9000 },
      { fare: 2500, baggageFee: 0 },
    ],
  },
  ...fields,
});

describe('toFlightBookingSummary (FLT-21)', () => {
  it('returns every field of the summary', () => {
    expect(toFlightBookingSummary(source())).toEqual({
      flight: FLIGHT,
      airline: { id: '6740f1c2a4b5c6d7e8f90999', name: 'Nile Air', code: 'NP' },
      cabin: 'economy',
      seats: 1,
      passengerCounts: { adults: 1, children: 0, infants: 1 },
      passengers: [
        {
          fullName: 'Sara Ahmed',
          dateOfBirth: '1990-05-14',
          type: 'adult',
          passportNumber: 'A12345678',
          fare: 25000,
          extraBags: { bags: 2, weightKg: 40 },
          baggageFee: 9000,
        },
        {
          fullName: 'Baby Ahmed',
          dateOfBirth: '2026-03-01',
          type: 'infant',
          passportNumber: 'C12345678',
          fare: 2500,
          extraBags: null,
          baggageFee: 0,
        },
      ],
      baggage: {
        freeBags: 1,
        maxBagKg: 23,
        extraBagPrice: 4500,
        maxExtraBags: 2,
      },
      returnTrip: null,
      currency: 'USD',
      fareTotal: 27500,
      baggageTotal: 9000,
      total: 36500,
      priceNote: SUMMARY_PRICE_NOTE,
    });
  });

  it('shows extraBagPrice null and 0 extra bags for an airline without a rule', () => {
    const summary = toFlightBookingSummary(
      source({
        airline: { _id: AIRLINE_ID, name: 'Nile Air', code: 'NP' },
      }),
    );

    expect(summary.baggage).toEqual({
      freeBags: 1,
      maxBagKg: 23,
      extraBagPrice: null,
      maxExtraBags: 0,
    });
  });

  it('never returns an id, a status, a hold, an owner, seat counters or Mongo internals', () => {
    const summary = toFlightBookingSummary(source());

    for (const key of [
      'id',
      '_id',
      'status',
      'holdExpiresAt',
      'reference',
      'userId',
      'segments',
      'policyAcceptedAt',
    ]) {
      expect(summary).not.toHaveProperty(key);
    }
    expect(summary.airline).not.toHaveProperty('policy');
    expect(summary.airline).not.toHaveProperty('_id');
    for (const key of ['bookedSeats', 'heldSeats', 'totalSeats', 'price']) {
      expect(summary.baggage).not.toHaveProperty(key);
    }
  });

  it('tells the user the hold confirms prices and seats', () => {
    expect(toFlightBookingSummary(source()).priceNote).toBe(
      'Prices and seats are confirmed when you proceed to payment (POST /api/flight-bookings/hold).',
    );
  });
});

describe('toFlightBookingSummary: round trip (FLT-12(a))', () => {
  const RETURN_FLIGHT = { id: '6740f1c2a4b5c6d7e8f90789' } as FlightResponseDto;
  const RETURN_AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90888');
  const roundTrip = (
    returnAirline: FlightBookingSummarySource['airline'] = {
      _id: RETURN_AIRLINE_ID,
      name: 'Delta Sky',
      code: 'DS',
      policy: { extraBagPrice: 4000, maxExtraBags: 1 },
    },
  ) =>
    source({
      returnTrip: {
        flight: RETURN_FLIGHT,
        airline: returnAirline,
        cabin: { cabin: CabinClass.Business, freeBags: 2, maxBagKg: 32 },
        passengers: [{}, { extraBags: { bags: 1, weightKg: 10 } }],
        price: {
          fareTotal: 66000,
          baggageTotal: 4000,
          total: 70000,
          perPassenger: [
            { fare: 60000, baggageFee: 0 },
            { fare: 6000, baggageFee: 4000 },
          ],
        },
      },
    });

  it('shows the return flight, its airline, cabin, what each passenger pays on it and its bag rule', () => {
    expect(toFlightBookingSummary(roundTrip()).returnTrip).toEqual({
      flight: RETURN_FLIGHT,
      airline: {
        id: '6740f1c2a4b5c6d7e8f90888',
        name: 'Delta Sky',
        code: 'DS',
      },
      cabin: 'business',
      passengers: [
        { fare: 60000, extraBags: null, baggageFee: 0 },
        { fare: 6000, extraBags: { bags: 1, weightKg: 10 }, baggageFee: 4000 },
      ],
      baggage: {
        freeBags: 2,
        maxBagKg: 32,
        extraBagPrice: 4000,
        maxExtraBags: 1,
      },
      fareTotal: 66000,
      baggageTotal: 4000,
    });
  });

  it('keeps the outbound flight at the top level and totals both flights', () => {
    const summary = toFlightBookingSummary(roundTrip());

    expect(summary.flight).toBe(FLIGHT);
    expect(summary.cabin).toBe('economy');
    expect(summary.passengers.map((passenger) => passenger.fare)).toEqual([
      25000, 2500,
    ]);
    expect(summary.fareTotal).toBe(27500 + 66000);
    expect(summary.baggageTotal).toBe(9000 + 4000);
    expect(summary.total).toBe(27500 + 66000 + 9000 + 4000);
  });

  it('shows extraBagPrice null for a return airline without a rule', () => {
    const summary = toFlightBookingSummary(
      roundTrip({ _id: RETURN_AIRLINE_ID, name: 'Delta Sky', code: 'DS' }),
    );

    expect(summary.returnTrip?.baggage).toEqual({
      freeBags: 2,
      maxBagKg: 32,
      extraBagPrice: null,
      maxExtraBags: 0,
    });
    expect(summary.returnTrip?.airline).not.toHaveProperty('policy');
  });
});
