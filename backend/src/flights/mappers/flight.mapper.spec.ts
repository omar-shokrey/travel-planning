import { Types } from 'mongoose';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightStatus } from '../models/flight-status.enum';
import { toCabinResponse, toFlightResponse } from './flight.mapper';

const cabinId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');

/** A stored cabin with 12 seats booked and 3 held for a payment. */
const storedCabin = {
  _id: cabinId,
  cabin: CabinClass.Business,
  totalSeats: 30,
  bookedSeats: 12,
  heldSeats: 3,
  price: 150000,
  freeBags: 2,
  maxBagKg: 32,
};

describe('toFlightResponse (FLT-03, FLT-04)', () => {
  const id = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
  const airlineId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
  const stored = {
    _id: id,
    airlineId,
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: new Date('2027-06-15T11:30:00.000Z'),
    arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
    departureDateLocal: '2027-06-15',
    status: FlightStatus.Scheduled,
    cabins: [storedCabin],
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:05:00.000Z'),
    // Internal fields of a stored document never leave the API.
    __v: 0,
  };

  it('returns the public fields: string ids, UTC ISO moments, the local date and the cabins', () => {
    expect(toFlightResponse(stored)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90456',
      airlineId: '6740f1c2a4b5c6d7e8f90123',
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2027-06-15T11:30:00.000Z',
      arrivalAt: '2027-06-15T22:30:00.000Z',
      departureDateLocal: '2027-06-15',
      status: 'scheduled',
      cabins: [
        {
          id: '6740f1c2a4b5c6d7e8f90789',
          cabin: 'business',
          totalSeats: 30,
          availableSeats: 15,
          price: 150000,
          currency: 'USD',
          freeBags: 2,
          maxBagKg: 32,
        },
      ],
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:05:00.000Z',
    });
  });

  it('never returns _id or __v', () => {
    const response = toFlightResponse(stored);

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
  });

  it('reads a lean flight stored before FLT-04, with no cabins field, as no cabins', () => {
    const { cabins: _cabins, ...withoutCabins } = stored;

    expect(toFlightResponse(withoutCabins).cabins).toEqual([]);
  });

  it('keeps the order of the stored cabins', () => {
    const economy = {
      ...storedCabin,
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
    };

    expect(
      toFlightResponse({
        ...stored,
        cabins: [economy, storedCabin],
      }).cabins.map((cabin) => cabin.cabin),
    ).toEqual(['economy', 'business']);
  });
});

describe('toCabinResponse (FLT-04)', () => {
  it('computes the available seats: total minus booked minus held', () => {
    expect(toCabinResponse(storedCabin).availableSeats).toBe(15);
    expect(
      toCabinResponse({ ...storedCabin, bookedSeats: 0, heldSeats: 0 })
        .availableSeats,
    ).toBe(30);
    expect(
      toCabinResponse({ ...storedCabin, bookedSeats: 25, heldSeats: 5 })
        .availableSeats,
    ).toBe(0);
  });

  it('gives the price in whole minor units of the platform currency, USD', () => {
    const response = toCabinResponse(storedCabin);

    expect(response.price).toBe(150000);
    expect(Number.isInteger(response.price)).toBe(true);
    expect(response.currency).toBe('USD');
  });

  it('never returns the seat counters or the stored _id', () => {
    expect(Object.keys(toCabinResponse(storedCabin)).sort()).toEqual([
      'availableSeats',
      'cabin',
      'currency',
      'freeBags',
      'id',
      'maxBagKg',
      'price',
      'totalSeats',
    ]);
  });
});
