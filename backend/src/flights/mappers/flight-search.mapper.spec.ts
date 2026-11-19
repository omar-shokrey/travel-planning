import { Types } from 'mongoose';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightStatus } from '../models/flight-status.enum';
import {
  type FlightSearchSource,
  toFlightSearchCabin,
  toFlightSearchResult,
} from './flight-search.mapper';

const NOW = new Date('2027-06-01T00:00:00.000Z');
const ZONES = { departure: 'Africa/Cairo', arrival: 'America/New_York' };

const cabin = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90789'),
  cabin: CabinClass.Business,
  totalSeats: 20,
  bookedSeats: 5,
  heldSeats: 3,
  price: 90000,
  freeBags: 2,
  maxBagKg: 32,
};

const source = (): FlightSearchSource => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90456'),
  airlineId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  flightNumber: 'MS985',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  // 15 June 2027, 14:30 in Cairo (UTC+3 in summer), 18:30 in New York.
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
  createdAt: new Date('2027-05-01T08:00:00.000Z'),
  updatedAt: new Date('2027-05-02T08:00:00.000Z'),
  fittingCabins: [cabin],
  airline: {
    _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
    name: 'EgyptAir',
    code: 'MS',
    logo: 'logo.png',
  },
});

describe('toFlightSearchResult (FLT-11)', () => {
  it('gives the flight as every flight response, its airline and only the cabins that fit', () => {
    expect(toFlightSearchResult(source(), NOW, ZONES)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90456',
      airlineId: '6740f1c2a4b5c6d7e8f90123',
      flightNumber: 'MS985',
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
      createdAt: '2027-05-01T08:00:00.000Z',
      updatedAt: '2027-05-02T08:00:00.000Z',
      airline: {
        id: '6740f1c2a4b5c6d7e8f90123',
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: '/api/uploads/logo.png',
      },
      cabins: [
        {
          id: '6740f1c2a4b5c6d7e8f90789',
          cabin: 'business',
          price: 90000,
          currency: 'USD',
          availableSeats: 12,
          freeBags: 2,
          maxBagKg: 32,
        },
      ],
    });
  });

  it('never shows the seat counters, the seat total or an internal field', () => {
    const stored = { ...source(), __v: 4, internal: 'x' } as FlightSearchSource;
    const result = toFlightSearchResult(stored, NOW, ZONES);
    const text = JSON.stringify(result);

    for (const internal of [
      'bookedSeats',
      'heldSeats',
      'totalSeats',
      '__v',
      '_id',
      'internal',
      'logo"',
      'fittingCabins',
    ]) {
      expect(text).not.toContain(internal);
    }
    expect(Object.keys(result.cabins[0]).sort()).toEqual([
      'availableSeats',
      'cabin',
      'currency',
      'freeBags',
      'id',
      'maxBagKg',
      'price',
    ]);
    expect(Object.keys(result.airline).sort()).toEqual([
      'code',
      'id',
      'logoUrl',
      'name',
    ]);
  });

  it('shows the status at now (FLT-30) and UTC strings ending in Z', () => {
    const result = toFlightSearchResult(source(), NOW, ZONES);

    expect(result.status).toBe('scheduled');
    for (const field of [
      'departureAt',
      'arrivalAt',
      'createdAt',
      'updatedAt',
    ] as const) {
      expect(result[field]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it('maps a cabin to exactly what the user needs to choose it', () => {
    expect(
      toFlightSearchCabin({ ...cabin, bookedSeats: 0, heldSeats: 0 }),
    ).toEqual({
      id: '6740f1c2a4b5c6d7e8f90789',
      cabin: 'business',
      price: 90000,
      currency: 'USD',
      availableSeats: 20,
      freeBags: 2,
      maxBagKg: 32,
    });
  });
});
