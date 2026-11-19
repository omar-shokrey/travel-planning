import { Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';
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
    baggageTotal: 4500,
    total: 57000,
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
    passengers: [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'A12345678',
        type: PassengerType.Adult,
        baggage: [{ segment: 0, bags: 1, weightKg: 20 }],
      },
      {
        fullName: 'Omar Ahmed',
        dateOfBirth: '1992-01-30',
        passportNumber: 'B12345678',
        type: PassengerType.Adult,
        baggage: [],
      },
      {
        fullName: 'Baby Ahmed',
        dateOfBirth: '2026-03-01',
        passportNumber: 'C12345678',
        type: PassengerType.Infant,
        baggage: [],
      },
    ],
    createdAt: new Date('2026-11-19T10:00:00.000Z'),
    updatedAt: new Date('2026-11-19T10:00:00.000Z'),
    ...fields,
  }) as FlightBookingSource;

describe('toFlightBookingResponse (FLT-22, FLT-19)', () => {
  it('returns the public fields, ids as strings and moments as UTC Z strings', () => {
    expect(toFlightBookingResponse(stored())).toEqual({
      id: '6740f1c2a4b5c6d7e8f90789',
      status: 'pending_payment',
      holdExpiresAt: '2026-11-19T10:10:00.000Z',
      currency: 'USD',
      fareTotal: 52500,
      baggageTotal: 4500,
      total: 57000,
      segments: [
        {
          flightId: '6740f1c2a4b5c6d7e8f90456',
          cabin: 'economy',
          fare: 25000,
          seatsReserved: 2,
        },
      ],
      passengerCounts: { adults: 2, children: 0, infants: 1 },
      passengers: [
        {
          fullName: 'Sara Ahmed',
          dateOfBirth: '1990-05-14',
          type: 'adult',
          passportNumber: 'A12345678',
          extraBags: { bags: 1, weightKg: 20 },
          returnExtraBags: null,
        },
        {
          fullName: 'Omar Ahmed',
          dateOfBirth: '1992-01-30',
          type: 'adult',
          passportNumber: 'B12345678',
          extraBags: null,
          returnExtraBags: null,
        },
        {
          fullName: 'Baby Ahmed',
          dateOfBirth: '2026-03-01',
          type: 'infant',
          passportNumber: 'C12345678',
          extraBags: null,
          returnExtraBags: null,
        },
      ],
      createdAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('shows no passengers and no baggage fee for a booking saved before FLT-19', () => {
    const response = toFlightBookingResponse(
      stored({
        passengers: undefined,
        baggageTotal: undefined,
      } as unknown as Partial<FlightBookingSource>),
    );

    expect(response.passengers).toEqual([]);
    expect(response.baggageTotal).toBe(0);
  });

  it('shows the bags of segment 0 as extraBags and of segment 1 as returnExtraBags (FLT-12)', () => {
    const response = toFlightBookingResponse(
      stored({
        passengers: [
          {
            fullName: 'Sara Ahmed',
            dateOfBirth: '1990-05-14',
            passportNumber: 'A12345678',
            type: PassengerType.Adult,
            baggage: [{ segment: 1, bags: 2, weightKg: 30 }],
          },
        ],
      }),
    );

    expect(response.passengers[0].extraBags).toBeNull();
    expect(response.passengers[0].returnExtraBags).toEqual({
      bags: 2,
      weightKg: 30,
    });
  });

  it('shows no bags for a passenger stored without a baggage list', () => {
    const response = toFlightBookingResponse(
      stored({
        passengers: [
          {
            fullName: 'Sara Ahmed',
            dateOfBirth: '1990-05-14',
            passportNumber: 'A12345678',
            type: PassengerType.Adult,
          } as never,
        ],
      }),
    );

    expect(response.passengers[0]).toMatchObject({
      extraBags: null,
      returnExtraBags: null,
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
