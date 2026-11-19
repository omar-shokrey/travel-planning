import { Types } from 'mongoose';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightStatus } from '../models/flight-status.enum';
import {
  type DetailsAirlineSource,
  toFlightDetails,
  toFlightDetailsCabin,
} from './flight-details.mapper';
import type { CabinSource, FlightSource } from './flight.mapper';

const NOW = new Date('2027-06-01T09:00:00.000Z');
const ZONES = { departure: 'Africa/Cairo', arrival: 'America/New_York' };

const cabin = (fields: Partial<CabinSource> = {}): CabinSource => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
  cabin: CabinClass.Economy,
  totalSeats: 100,
  bookedSeats: 40,
  heldSeats: 2,
  price: 25000,
  freeBags: 1,
  maxBagKg: 23,
  ...fields,
});

const flight = (fields: Partial<FlightSource> = {}): FlightSource => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90456'),
  airlineId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  // 14:30 in Cairo (UTC+3) and 18:30 in New York (UTC-4).
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
  createdAt: NOW,
  updatedAt: NOW,
  cabins: [cabin()],
  ...fields,
});

const airline = (
  fields: Partial<DetailsAirlineSource> = {},
): DetailsAirlineSource => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'EgyptAir',
  code: 'MS',
  logo: 'logo.png',
  policy: {
    cancellationTiers: [
      { daysBefore: 7, refundPercent: 80 },
      { daysBefore: 1, refundPercent: 20 },
    ],
    extraBagPrice: 4500,
    maxExtraBags: 2,
  },
  ...fields,
});

describe('flight details mapper (FLT-17)', () => {
  it('shows the airline, the flight, both times in UTC and local time, the duration, the cabins and the airline policy', () => {
    expect(toFlightDetails(flight(), airline(), NOW, ZONES)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90456',
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2027-06-15T11:30:00.000Z',
      arrivalAt: '2027-06-15T22:30:00.000Z',
      departureLocal: '2027-06-15T14:30',
      departureTimeZone: 'Africa/Cairo',
      departureUtcOffset: '+03:00',
      arrivalLocal: '2027-06-15T18:30',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
      departureDateLocal: '2027-06-15',
      status: 'scheduled',
      airline: {
        id: '6740f1c2a4b5c6d7e8f90123',
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: '/api/uploads/logo.png',
      },
      durationMinutes: 660,
      cabins: [
        {
          id: '6740f1c2a4b5c6d7e8f90789',
          cabin: 'economy',
          price: 25000,
          currency: 'USD',
          seatsRemaining: 58,
          freeBags: 1,
          maxBagKg: 23,
        },
      ],
      extraBagPrice: 4500,
      extraBagCurrency: 'USD',
      maxExtraBags: 2,
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 80 },
        { daysBefore: 1, refundPercent: 20 },
      ],
    });
  });

  it('never shows the seat counters, the seat total or an internal field', () => {
    const details = toFlightDetails(flight(), airline(), NOW, ZONES);
    const shown = JSON.stringify(details);

    for (const hidden of [
      'bookedSeats',
      'heldSeats',
      'totalSeats',
      'availableSeats',
      'airlineId',
      '__v',
      'createdAt',
      'policy',
    ]) {
      expect(shown).not.toContain(hidden);
    }
  });

  it('never shows fewer than 0 seats remaining', () => {
    expect(
      toFlightDetailsCabin(
        cabin({ totalSeats: 10, bookedSeats: 9, heldSeats: 3 }),
      ).seatsRemaining,
    ).toBe(0);
    expect(
      toFlightDetailsCabin(
        cabin({ totalSeats: 10, bookedSeats: 6, heldSeats: 4 }),
      ).seatsRemaining,
    ).toBe(0);
    expect(
      toFlightDetailsCabin(
        cabin({ totalSeats: 10, bookedSeats: 6, heldSeats: 3 }),
      ).seatsRemaining,
    ).toBe(1);
  });

  it('measures the duration in UTC: a daylight saving change does not change it', () => {
    // New York leaves daylight saving on 2027-11-07 at 06:00 UTC.
    const overTheChange = flight({
      departureAt: new Date('2027-11-07T03:00:00.000Z'),
      arrivalAt: new Date('2027-11-07T09:15:00.000Z'),
    });

    expect(
      toFlightDetails(overTheChange, airline(), NOW, ZONES).durationMinutes,
    ).toBe(375);
  });

  it('shows the status at now: a cancelled flight is cancelled, a past scheduled one departed (FLT-30)', () => {
    expect(
      toFlightDetails(
        flight({ status: FlightStatus.Cancelled }),
        airline(),
        NOW,
        ZONES,
      ).status,
    ).toBe('cancelled');
    expect(
      toFlightDetails(
        flight(),
        airline(),
        new Date('2027-06-15T12:00:00.000Z'),
        ZONES,
      ).status,
    ).toBe('departed');
  });

  it('reads an airline with no policy as no extra bag and no tiers, and a flight with no cabins as none', () => {
    const details = toFlightDetails(
      flight({ cabins: undefined }),
      airline({ policy: undefined }),
      NOW,
      ZONES,
    );

    expect(details).toMatchObject({
      cabins: [],
      extraBagPrice: null,
      extraBagCurrency: 'USD',
      maxExtraBags: 0,
      cancellationTiers: [],
    });
  });
});
