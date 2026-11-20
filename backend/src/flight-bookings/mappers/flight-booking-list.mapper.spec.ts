import { Types } from 'mongoose';
import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightStatus } from '../../flights/models/flight-status.enum';
import { RefundStatus } from '../../payments/refunds/enums/refund-status.enum';
import { CancelledBy } from '../enums/cancelled-by.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import {
  toBookedFlight,
  toFlightBookingDetails,
  toFlightBookingListItem,
} from './flight-booking-list.mapper';
import type { FlightBookingSource } from './flight-booking.mapper';

const OUT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const BACK = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');

const flight = (id: Types.ObjectId, number: string) =>
  ({
    id: id.toString(),
    airlineId: 'airline-1',
    flightNumber: number,
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: '2027-01-10T08:00:00.000Z',
    arrivalAt: '2027-01-10T20:00:00.000Z',
    departureLocal: '2027-01-10T10:00',
    departureTimeZone: 'Africa/Cairo',
    departureUtcOffset: '+02:00',
    arrivalLocal: '2027-01-10T15:00',
    arrivalTimeZone: 'America/New_York',
    arrivalUtcOffset: '-05:00',
    departureDateLocal: '2027-01-10',
    status: FlightStatus.Scheduled,
    cabins: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }) as FlightResponseDto;

const booking = (fields: Partial<FlightBookingSource> = {}) =>
  ({
    _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa'),
    userId: new Types.ObjectId(),
    reference: 'FB7K2Q9M',
    status: FlightBookingStatus.Confirmed,
    currency: 'USD',
    fareTotal: 50000,
    baggageTotal: 0,
    total: 50000,
    segments: [
      {
        flightId: OUT,
        cabin: CabinClass.Economy,
        fare: 25000,
        seatsReserved: 1,
      },
      {
        flightId: BACK,
        cabin: CabinClass.Business,
        fare: 25000,
        seatsReserved: 1,
      },
    ],
    passengerCounts: { adults: 1, children: 0, infants: 1 },
    passengers: [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'A12345678',
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
  }) as unknown as FlightBookingSource;

const flights = new Map([
  [OUT.toString(), flight(OUT, 'MS777')],
  [BACK.toString(), flight(BACK, 'MS778')],
]);

describe('toBookedFlight (FLT-25)', () => {
  it('keeps the route, the times at each airport and the status only', () => {
    expect(toBookedFlight(flight(OUT, 'MS777'))).toEqual({
      id: OUT.toString(),
      flightNumber: 'MS777',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2027-01-10T08:00:00.000Z',
      departureLocal: '2027-01-10T10:00',
      departureTimeZone: 'Africa/Cairo',
      arrivalAt: '2027-01-10T20:00:00.000Z',
      arrivalLocal: '2027-01-10T15:00',
      arrivalTimeZone: 'America/New_York',
      departureDateLocal: '2027-01-10',
      status: FlightStatus.Scheduled,
    });
  });
});

describe('toFlightBookingListItem (FLT-25)', () => {
  it('shows the reference, each flight with its cabin and seats, the passengers, the status and the chosen seats', () => {
    const item = toFlightBookingListItem(booking(), flights, [
      {
        bookingId: booking()._id,
        segmentIndex: 1,
        passengerIndex: 0,
        seatNumber: '311A',
      },
    ]);

    expect(item).toEqual({
      id: '6740f1c2a4b5c6d7e8f90aaa',
      reference: 'FB7K2Q9M',
      status: FlightBookingStatus.Confirmed,
      segments: [
        {
          cabin: CabinClass.Economy,
          seatsReserved: 1,
          flight: toBookedFlight(flight(OUT, 'MS777')),
        },
        {
          cabin: CabinClass.Business,
          seatsReserved: 1,
          flight: toBookedFlight(flight(BACK, 'MS778')),
        },
      ],
      passengers: [
        { fullName: 'Sara Ahmed', type: PassengerType.Adult },
        { fullName: 'Baby Ahmed', type: PassengerType.Infant },
      ],
      total: 50000,
      currency: 'USD',
      createdAt: '2026-11-19T10:00:00.000Z',
      cancelledAt: null,
      // FLT-28: the adult only; the infant takes no seat.
      seats: [
        {
          segmentIndex: 0,
          flightId: OUT.toString(),
          cabin: CabinClass.Economy,
          passengers: [{ passengerIndex: 0, seatNumber: null }],
        },
        {
          segmentIndex: 1,
          flightId: BACK.toString(),
          cabin: CabinClass.Business,
          passengers: [{ passengerIndex: 0, seatNumber: '311A' }],
        },
      ],
    });
    expect(JSON.stringify(item)).not.toContain('A12345678');
  });

  it('shows no reference while waiting for payment, a missing flight as null and the cancellation time', () => {
    const item = toFlightBookingListItem(
      booking({
        reference: undefined,
        status: FlightBookingStatus.Cancelled,
        cancelledAt: new Date('2026-11-20T09:00:00.000Z'),
        passengers: undefined,
      }),
      new Map([[OUT.toString(), flight(OUT, 'MS777')]]),
      [],
    );

    expect(item.reference).toBeNull();
    expect(item.segments[1].flight).toBeNull();
    expect(item.passengers).toEqual([]);
    expect(item.seats.map((segment) => segment.passengers)).toEqual([[], []]);
    expect(item.cancelledAt).toBe('2026-11-20T09:00:00.000Z');
  });
});

describe('toFlightBookingDetails (FLT-25)', () => {
  it('adds each full flight, the acceptance and the cancellation to the booking', () => {
    const refund = {
      id: 'refund-1',
      status: RefundStatus.Pending,
      amount: 50000,
      currency: 'USD',
      refundPercent: 100,
    };
    const details = toFlightBookingDetails(
      booking({
        status: FlightBookingStatus.Cancelled,
        policyAcceptedAt: new Date('2026-11-19T10:01:00.000Z'),
        cancelledAt: new Date('2026-11-20T09:00:00.000Z'),
        cancelledBy: CancelledBy.Provider,
        refundPercent: 100,
      }),
      new Map([[OUT.toString(), flight(OUT, 'MS777')]]),
      refund,
      [
        {
          bookingId: booking()._id,
          segmentIndex: 0,
          passengerIndex: 0,
          seatNumber: '12C',
        },
      ],
    );

    expect(details).toMatchObject({
      id: '6740f1c2a4b5c6d7e8f90aaa',
      reference: 'FB7K2Q9M',
      status: FlightBookingStatus.Cancelled,
      flights: [flight(OUT, 'MS777'), null],
      policyAcceptedAt: '2026-11-19T10:01:00.000Z',
      cancelledAt: '2026-11-20T09:00:00.000Z',
      cancelledBy: CancelledBy.Provider,
      refundPercent: 100,
      refund,
    });
    expect(details.passengers[0].passportNumber).toBe('A12345678');
    expect(details.seats[0].passengers).toEqual([
      { passengerIndex: 0, seatNumber: '12C' },
    ]);
    expect(details.seats[1].passengers).toEqual([
      { passengerIndex: 0, seatNumber: null },
    ]);
  });

  it('has nulls for a booking that was never cancelled or accepted', () => {
    expect(toFlightBookingDetails(booking(), flights, null, [])).toMatchObject({
      policyAcceptedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      refundPercent: null,
      refund: null,
    });
  });
});
