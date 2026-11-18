import { Types } from 'mongoose';
import { FlightStatus } from '../models/flight-status.enum';
import { toFlightResponse } from './flight.mapper';

describe('toFlightResponse (FLT-03)', () => {
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
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:05:00.000Z'),
    // Internal fields of a stored document never leave the API.
    __v: 0,
  };

  it('returns the public fields: string ids, UTC ISO moments and the local date', () => {
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
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:05:00.000Z',
    });
  });

  it('never returns _id or __v', () => {
    const response = toFlightResponse(stored);

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
  });
});
