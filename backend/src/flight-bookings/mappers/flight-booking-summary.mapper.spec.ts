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
  plan: {
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
  },
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
