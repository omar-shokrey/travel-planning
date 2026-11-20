import { Types } from 'mongoose';
import { FlightBookingStatus } from '../../flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from '../../flight-bookings/enums/passenger-type.enum';
import { CabinClass } from '../models/cabin-class.enum';
import {
  type BookingOfFlightSource,
  toFlightBookingOfFlight,
} from './flight-booking-of-flight.mapper';

const OUT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const BACK = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');

const booking = (fields: Partial<BookingOfFlightSource> = {}) =>
  ({
    _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa'),
    reference: 'FB7K2Q9M',
    status: FlightBookingStatus.Confirmed,
    segments: [
      { flightId: OUT, cabin: CabinClass.Economy, seatsReserved: 2 },
      { flightId: BACK, cabin: CabinClass.Business, seatsReserved: 2 },
    ],
    passengers: [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'A12345678',
        type: PassengerType.Adult,
      },
    ],
    ...fields,
  }) as unknown as BookingOfFlightSource;

describe('toFlightBookingOfFlight (FLT-29)', () => {
  it('shows the cabin and seats of the segment on this flight, and no personal document', () => {
    const shown = toFlightBookingOfFlight(booking(), BACK);

    expect(shown).toEqual({
      bookingId: '6740f1c2a4b5c6d7e8f90aaa',
      reference: 'FB7K2Q9M',
      status: FlightBookingStatus.Confirmed,
      cabin: CabinClass.Business,
      seats: 2,
      passengers: [{ fullName: 'Sara Ahmed', type: PassengerType.Adult }],
      cancelledAt: null,
    });
    expect(JSON.stringify(shown)).not.toMatch(/A12345678|1990-05-14/);
  });

  it('shows the cancellation time, and no passengers for a booking saved before FLT-19', () => {
    const shown = toFlightBookingOfFlight(
      booking({
        status: FlightBookingStatus.Cancelled,
        cancelledAt: new Date('2026-11-20T09:00:00.000Z'),
        passengers: undefined,
        reference: undefined,
      }),
      OUT,
    );

    expect(shown).toMatchObject({
      reference: '',
      cabin: CabinClass.Economy,
      passengers: [],
      cancelledAt: '2026-11-20T09:00:00.000Z',
    });
  });

  it('falls back to the first segment if none is on the flight', () => {
    expect(toFlightBookingOfFlight(booking(), new Types.ObjectId()).cabin).toBe(
      CabinClass.Economy,
    );
  });
});
