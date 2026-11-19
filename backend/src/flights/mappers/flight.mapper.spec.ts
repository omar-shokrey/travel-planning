import { Types } from 'mongoose';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightStatus } from '../models/flight-status.enum';
import { toCabinResponse, toFlightResponse } from './flight.mapper';

const cabinId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');

/** "Now" for every test: before the departure of the stored flight below. */
const NOW = new Date('2027-01-10T00:00:00.000Z');

/** The zones of the two airports, CAI and JFK (GEN-06). */
const ZONES = { departure: 'Africa/Cairo', arrival: 'America/New_York' };

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

describe('toFlightResponse (FLT-03, FLT-04, FLT-30, GEN-06)', () => {
  const id = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
  const airlineId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
  // Cairo 10:00 to New York 15:00 on 15 January (winter in both).
  const stored = {
    _id: id,
    airlineId,
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: new Date('2027-01-15T08:00:00.000Z'),
    arrivalAt: new Date('2027-01-15T20:00:00.000Z'),
    departureDateLocal: '2027-01-15',
    status: FlightStatus.Scheduled,
    cabins: [storedCabin],
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:05:00.000Z'),
    // Internal fields of a stored document never leave the API.
    __v: 0,
  };

  it('returns the public fields: string ids, UTC ISO moments, the local times and date, and the cabins', () => {
    expect(toFlightResponse(stored, NOW, ZONES)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90456',
      airlineId: '6740f1c2a4b5c6d7e8f90123',
      flightNumber: 'MS123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2027-01-15T08:00:00.000Z',
      arrivalAt: '2027-01-15T20:00:00.000Z',
      departureLocal: '2027-01-15T10:00',
      departureTimeZone: 'Africa/Cairo',
      departureUtcOffset: '+02:00',
      arrivalLocal: '2027-01-15T15:00',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-05:00',
      departureDateLocal: '2027-01-15',
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
    const response = toFlightResponse(stored, NOW, ZONES);

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
  });

  it('keeps the stored UTC moments unchanged next to the local times', () => {
    const response = toFlightResponse(stored, NOW, ZONES);

    expect(response.departureAt).toBe(stored.departureAt.toISOString());
    expect(response.arrivalAt).toBe(stored.arrivalAt.toISOString());
    expect(stored.departureAt.toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('shows each time in the zone it is given, with the offset at that moment', () => {
    const summer = {
      ...stored,
      departureAirport: 'NRT',
      departureAt: new Date('2027-07-15T03:00:00.000Z'),
      arrivalAt: new Date('2027-07-15T19:00:00.000Z'),
    };

    expect(
      toFlightResponse(summer, NOW, {
        departure: 'Asia/Tokyo',
        arrival: 'America/New_York',
      }),
    ).toMatchObject({
      departureLocal: '2027-07-15T12:00',
      departureTimeZone: 'Asia/Tokyo',
      departureUtcOffset: '+09:00',
      arrivalLocal: '2027-07-15T15:00',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
    });
  });

  it('reads a lean flight stored before FLT-04, with no cabins field, as no cabins', () => {
    const { cabins: _cabins, ...withoutCabins } = stored;

    expect(toFlightResponse(withoutCabins, NOW, ZONES).cabins).toEqual([]);
  });

  it('keeps the order of the stored cabins', () => {
    const economy = {
      ...storedCabin,
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
    };

    expect(
      toFlightResponse(
        { ...stored, cabins: [economy, storedCabin] },
        NOW,
        ZONES,
      ).cabins.map((cabin) => cabin.cabin),
    ).toEqual(['economy', 'business']);
  });
});

describe('toFlightResponse status (FLT-30)', () => {
  const departure = '2027-06-15T11:30:00.000Z';
  const flight = (status: FlightStatus) => ({
    _id: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: new Date(departure),
    arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
    departureDateLocal: '2027-06-15',
    status,
    createdAt: NOW,
    updatedAt: NOW,
  });

  it.each([
    ['1 ms before the departure', '2027-06-15T11:29:59.999Z', 'scheduled'],
    ['at the departure instant', departure, 'departed'],
    ['1 ms after the departure', '2027-06-15T11:30:00.001Z', 'departed'],
  ])(
    'answers a stored scheduled flight %s as %s, at the now it is given',
    (_case, now, expected) => {
      expect(
        toFlightResponse(flight(FlightStatus.Scheduled), new Date(now), ZONES)
          .status,
      ).toBe(expected);
    },
  );

  it('keeps a cancelled flight cancelled after its departure time', () => {
    expect(
      toFlightResponse(
        flight(FlightStatus.Cancelled),
        new Date('2027-07-01T00:00:00.000Z'),
        ZONES,
      ).status,
    ).toBe('cancelled');
  });

  it('keeps a stored departed flight departed', () => {
    expect(
      toFlightResponse(flight(FlightStatus.Departed), NOW, ZONES).status,
    ).toBe('departed');
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
