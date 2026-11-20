import { Types } from 'mongoose';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import {
  INFANT_SEAT_MESSAGE,
  SEATS_DEPARTED_MESSAGE,
  SEATS_FLIGHT_CANCELLED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
} from './flight-bookings.constants';
import {
  bookingStateError,
  flightStateError,
  holdsSeat,
  isTakenByAnother,
  passengerErrors,
  resolveSegmentIndex,
  seatMapErrors,
} from './seat-selection-rules';

const NOW = new Date('2027-01-01T12:00:00.000Z');
const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const OTHER = new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb');

describe('resolveSegmentIndex (FLT-28)', () => {
  it('uses the only segment of a one-way booking when none is sent', () => {
    expect(resolveSegmentIndex(1, undefined)).toEqual({ segmentIndex: 0 });
  });

  it('accepts 0 for a one-way booking and 0 or 1 for a round trip', () => {
    expect(resolveSegmentIndex(1, 0)).toEqual({ segmentIndex: 0 });
    expect(resolveSegmentIndex(2, 0)).toEqual({ segmentIndex: 0 });
    expect(resolveSegmentIndex(2, 1)).toEqual({ segmentIndex: 1 });
  });

  it('requires it for a round trip', () => {
    expect(resolveSegmentIndex(2, undefined)).toEqual({
      error: {
        field: 'segmentIndex',
        messages: [SEGMENT_INDEX_REQUIRED_MESSAGE],
      },
    });
  });

  it('refuses a segment the booking does not have', () => {
    expect(resolveSegmentIndex(1, 1)).toEqual({
      error: {
        field: 'segmentIndex',
        messages: ['segmentIndex must be 0: this booking has one flight'],
      },
    });
    expect(resolveSegmentIndex(2, 2)).toEqual({
      error: {
        field: 'segmentIndex',
        messages: ['segmentIndex must be between 0 and 1'],
      },
    });
  });
});

describe('passengerErrors (FLT-28)', () => {
  const passengers = [
    { type: PassengerType.Adult },
    { type: PassengerType.Child },
    { type: PassengerType.Infant },
  ];

  it('accepts adults and children', () => {
    expect(
      passengerErrors(passengers, [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1B' },
      ]),
    ).toEqual([]);
  });

  it('refuses an infant, who takes no seat', () => {
    expect(
      passengerErrors(passengers, [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 2, seatNumber: '1B' },
      ]),
    ).toEqual([
      { field: 'seats.1.passengerIndex', messages: [INFANT_SEAT_MESSAGE] },
    ]);
  });

  it('refuses a passenger the booking does not have', () => {
    expect(
      passengerErrors(passengers, [{ passengerIndex: 3, seatNumber: '1A' }]),
    ).toEqual([
      {
        field: 'seats.0.passengerIndex',
        messages: [
          'passengerIndex must be between 0 and 2: the position of the passenger in the booking',
        ],
      },
    ]);
  });
});

describe('seatMapErrors (FLT-28)', () => {
  const map = new Set(['1A', '1B']);

  it('accepts seats of the map', () => {
    expect(
      seatMapErrors(map, CabinClass.Economy, [
        { passengerIndex: 0, seatNumber: '1B' },
      ]),
    ).toEqual([]);
  });

  it('refuses each seat that is not on the map, naming the cabin', () => {
    expect(
      seatMapErrors(map, CabinClass.PremiumEconomy, [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '99F' },
      ]),
    ).toEqual([
      {
        field: 'seats.1.seatNumber',
        messages: [
          'Seat 99F is not on the seat map of the Premium economy cabin',
        ],
      },
    ]);
  });
});

describe('bookingStateError (FLT-28)', () => {
  it('allows a confirmed booking', () => {
    expect(bookingStateError(FlightBookingStatus.Confirmed)).toBeNull();
  });

  it.each([
    FlightBookingStatus.PendingPayment,
    FlightBookingStatus.Cancelled,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Completed,
  ])('refuses a %s booking', (status) => {
    expect(bookingStateError(status)).toBe(SEATS_NOT_CONFIRMED_MESSAGE);
  });
});

describe('flightStateError (FLT-28)', () => {
  const later = new Date(NOW.getTime() + 60_000);

  it('allows a scheduled flight that departs later', () => {
    expect(
      flightStateError(
        { status: FlightStatus.Scheduled, departureAt: later },
        NOW,
      ),
    ).toBeNull();
  });

  it('refuses a flight the airline cancelled', () => {
    expect(
      flightStateError(
        { status: FlightStatus.Cancelled, departureAt: later },
        NOW,
      ),
    ).toBe(SEATS_FLIGHT_CANCELLED_MESSAGE);
  });

  it('refuses a departed flight, and a scheduled one whose departure time has come', () => {
    expect(
      flightStateError(
        { status: FlightStatus.Departed, departureAt: later },
        NOW,
      ),
    ).toBe(SEATS_DEPARTED_MESSAGE);
    expect(
      flightStateError(
        { status: FlightStatus.Scheduled, departureAt: NOW },
        NOW,
      ),
    ).toBe(SEATS_DEPARTED_MESSAGE);
  });
});

describe('holdsSeat (FLT-28)', () => {
  const taken = [
    {
      bookingId: BOOKING,
      segmentIndex: 0,
      passengerIndex: 0,
      seatNumber: '1A',
    },
  ];

  it('is true only for the same passenger, segment, booking and seat', () => {
    const choice = { passengerIndex: 0, seatNumber: '1A' };
    expect(holdsSeat(taken, BOOKING.toString(), 0, choice)).toBe(true);
    expect(holdsSeat(taken, OTHER.toString(), 0, choice)).toBe(false);
    expect(holdsSeat(taken, BOOKING.toString(), 1, choice)).toBe(false);
    expect(
      holdsSeat(taken, BOOKING.toString(), 0, { ...choice, passengerIndex: 1 }),
    ).toBe(false);
    expect(
      holdsSeat(taken, BOOKING.toString(), 0, { ...choice, seatNumber: '1B' }),
    ).toBe(false);
  });
});

describe('isTakenByAnother (FLT-28)', () => {
  const taken = [
    {
      bookingId: BOOKING,
      segmentIndex: 0,
      passengerIndex: 0,
      seatNumber: '1A',
    },
    { bookingId: OTHER, segmentIndex: 0, passengerIndex: 0, seatNumber: '1B' },
  ];

  it('treats a free seat as free', () => {
    expect(
      isTakenByAnother(taken, BOOKING.toString(), 0, {
        passengerIndex: 0,
        seatNumber: '2C',
      }),
    ).toBe(false);
  });

  it("treats the passenger's own current seat as free for them", () => {
    expect(
      isTakenByAnother(taken, BOOKING.toString(), 0, {
        passengerIndex: 0,
        seatNumber: '1A',
      }),
    ).toBe(false);
  });

  it('treats a seat of another booking as taken', () => {
    expect(
      isTakenByAnother(taken, BOOKING.toString(), 0, {
        passengerIndex: 0,
        seatNumber: '1B',
      }),
    ).toBe(true);
  });

  it('treats a seat of another passenger of the same booking as taken, so no swap in one request', () => {
    expect(
      isTakenByAnother(taken, BOOKING.toString(), 0, {
        passengerIndex: 1,
        seatNumber: '1A',
      }),
    ).toBe(true);
  });

  it('treats the same passenger on another segment as someone else', () => {
    expect(
      isTakenByAnother(taken, BOOKING.toString(), 1, {
        passengerIndex: 0,
        seatNumber: '1A',
      }),
    ).toBe(true);
  });
});
