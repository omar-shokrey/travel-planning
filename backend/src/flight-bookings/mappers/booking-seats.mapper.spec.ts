import { Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { PassengerType } from '../enums/passenger-type.enum';
import { SeatStatus } from '../enums/seat-status.enum';
import { needsSeat, toSeatMap, toSegmentSeats } from './booking-seats.mapper';
import type { FlightBookingSource } from './flight-booking.mapper';

const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const OTHER = new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb');
const OUT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const BACK = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');

const passenger = (fullName: string, type: PassengerType) => ({
  fullName,
  dateOfBirth: '1990-05-14',
  passportNumber: 'A12345678',
  type,
  baggage: [],
});

const booking = (fields: Partial<FlightBookingSource> = {}) =>
  ({
    _id: BOOKING,
    userId: new Types.ObjectId(),
    status: FlightBookingStatus.Confirmed,
    segments: [
      { flightId: OUT, cabin: CabinClass.Economy, seatsReserved: 2 },
      { flightId: BACK, cabin: CabinClass.Business, seatsReserved: 2 },
    ],
    passengers: [
      passenger('Sara Ahmed', PassengerType.Adult),
      passenger('Omar Ahmed', PassengerType.Child),
      passenger('Baby Ahmed', PassengerType.Infant),
    ],
    ...fields,
  }) as unknown as FlightBookingSource;

const own = (
  segmentIndex: number,
  passengerIndex: number,
  seatNumber: string,
) => ({
  bookingId: BOOKING,
  segmentIndex,
  passengerIndex,
  seatNumber,
});

describe('needsSeat (FLT-12, FLT-28)', () => {
  it('gives adults and children a seat and an infant none', () => {
    expect(needsSeat(PassengerType.Adult)).toBe(true);
    expect(needsSeat(PassengerType.Child)).toBe(true);
    expect(needsSeat(PassengerType.Infant)).toBe(false);
  });
});

describe('toSegmentSeats (FLT-28)', () => {
  it('lists, per segment, every passenger who takes a seat with their seat or null', () => {
    expect(
      toSegmentSeats(booking(), [own(0, 1, '1B'), own(1, 0, '311A')]),
    ).toEqual([
      {
        segmentIndex: 0,
        flightId: OUT.toString(),
        cabin: CabinClass.Economy,
        passengers: [
          { passengerIndex: 0, seatNumber: null },
          { passengerIndex: 1, seatNumber: '1B' },
        ],
      },
      {
        segmentIndex: 1,
        flightId: BACK.toString(),
        cabin: CabinClass.Business,
        passengers: [
          { passengerIndex: 0, seatNumber: '311A' },
          { passengerIndex: 1, seatNumber: null },
        ],
      },
    ]);
  });

  it('lists no passenger for a booking without passengers', () => {
    const seats = toSegmentSeats(booking({ passengers: undefined }), []);

    expect(seats.map((segment) => segment.passengers)).toEqual([[], []]);
  });
});

describe('toSeatMap (FLT-28)', () => {
  const maps = [
    {
      seatNumbers: ['1A', '1B', '1C'],
      taken: [own(0, 0, '1A'), { ...own(0, 0, '1C'), bookingId: OTHER }],
    },
    { seatNumbers: ['311A'], taken: [] },
  ];

  it('marks each seat yours, taken or available, and never says who holds a taken seat', () => {
    const map = toSeatMap(booking(), maps, [own(0, 0, '1A')]);

    expect(map.bookingId).toBe(BOOKING.toString());
    expect(map.segments).toEqual([
      {
        segmentIndex: 0,
        flightId: OUT.toString(),
        cabin: CabinClass.Economy,
        seats: [
          { seatNumber: '1A', status: SeatStatus.Yours },
          { seatNumber: '1B', status: SeatStatus.Available },
          { seatNumber: '1C', status: SeatStatus.Taken },
        ],
      },
      {
        segmentIndex: 1,
        flightId: BACK.toString(),
        cabin: CabinClass.Business,
        seats: [{ seatNumber: '311A', status: SeatStatus.Available }],
      },
    ]);
    expect(JSON.stringify(map.segments)).not.toContain(OTHER.toString());
  });

  it('lists each passenger with their seat on each segment, and an infant with none', () => {
    const map = toSeatMap(booking(), maps, [
      own(0, 0, '1A'),
      own(1, 1, '311A'),
    ]);

    expect(map.passengers).toEqual([
      {
        passengerIndex: 0,
        fullName: 'Sara Ahmed',
        type: PassengerType.Adult,
        needsSeat: true,
        seats: ['1A', null],
      },
      {
        passengerIndex: 1,
        fullName: 'Omar Ahmed',
        type: PassengerType.Child,
        needsSeat: true,
        seats: [null, '311A'],
      },
      {
        passengerIndex: 2,
        fullName: 'Baby Ahmed',
        type: PassengerType.Infant,
        needsSeat: false,
        seats: [null, null],
      },
    ]);
  });

  it('still shows a seat the booking holds that is no longer on the map (the cabin got smaller)', () => {
    const map = toSeatMap(booking(), maps, [own(0, 0, '9F')]);

    expect(map.segments[0].seats.map((seat) => seat.seatNumber)).not.toContain(
      '9F',
    );
    expect(map.passengers[0].seats[0]).toBe('9F');
  });

  it('shows an empty map for a segment without one', () => {
    const map = toSeatMap(booking(), [maps[0]], []);

    expect(map.segments[1].seats).toEqual([]);
  });
});
