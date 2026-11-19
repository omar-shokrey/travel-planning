import { Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import {
  type FlightBookingSource,
  toFlightBookingResponse,
} from './flight-booking.mapper';

const BOOKING_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90789');
const FLIGHT_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');

const stored = (fields: Partial<FlightBookingSource> = {}) =>
  ({
    _id: BOOKING_ID,
    __v: 0,
    userId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
    status: FlightBookingStatus.PendingPayment,
    holdExpiresAt: new Date('2026-11-19T10:10:00.000Z'),
    currency: 'USD',
    fareTotal: 52500,
    total: 52500,
    segments: [
      {
        flightId: FLIGHT_ID,
        airlineId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90999'),
        cabin: CabinClass.Economy,
        fare: 25000,
        seatsReserved: 2,
      },
    ],
    passengerCounts: { adults: 2, children: 0, infants: 1 },
    createdAt: new Date('2026-11-19T10:00:00.000Z'),
    updatedAt: new Date('2026-11-19T10:00:00.000Z'),
    ...fields,
  }) as FlightBookingSource;

describe('toFlightBookingResponse (FLT-22)', () => {
  it('returns the public fields, ids as strings and moments as UTC Z strings', () => {
    expect(toFlightBookingResponse(stored())).toEqual({
      id: '6740f1c2a4b5c6d7e8f90789',
      status: 'pending_payment',
      holdExpiresAt: '2026-11-19T10:10:00.000Z',
      currency: 'USD',
      fareTotal: 52500,
      total: 52500,
      segments: [
        {
          flightId: '6740f1c2a4b5c6d7e8f90456',
          cabin: 'economy',
          fare: 25000,
          seatsReserved: 2,
        },
      ],
      passengerCounts: { adults: 2, children: 0, infants: 1 },
      createdAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('never returns the owner, the airline id or Mongo internals', () => {
    const response = toFlightBookingResponse(stored());

    for (const key of ['userId', '_id', '__v', 'updatedAt', 'reference']) {
      expect(response).not.toHaveProperty(key);
    }
    expect(response.segments[0]).not.toHaveProperty('airlineId');
  });

  it('shows the reference once the payment gave one', () => {
    expect(
      toFlightBookingResponse(stored({ reference: 'FB7K2Q9M' })).reference,
    ).toBe('FB7K2Q9M');
  });

  it('answers null for holdExpiresAt when there is no hold', () => {
    expect(
      toFlightBookingResponse(
        stored({
          status: FlightBookingStatus.Confirmed,
          holdExpiresAt: undefined,
        }),
      ).holdExpiresAt,
    ).toBeNull();
  });
});
