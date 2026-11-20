import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AirlinesService } from '../flights/airlines.service';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import {
  buildETicket,
  FlightBookingETicketService,
} from './flight-booking-e-ticket.service';
import { E_TICKET_NOT_CONFIRMED_MESSAGE } from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import type { FlightSeatsService } from './flight-seats.service';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';

const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const OUTBOUND_ID = new Types.ObjectId();
const RETURN_ID = new Types.ObjectId();
const AIRLINE_ID = new Types.ObjectId();

const booking = (fields: Partial<FlightBookingSource> = {}) =>
  ({
    _id: BOOKING_ID,
    userId: USER_ID,
    status: FlightBookingStatus.Confirmed,
    reference: 'FB-7KQ2MX',
    currency: 'USD',
    total: 52575,
    segments: [
      {
        flightId: OUTBOUND_ID,
        airlineId: AIRLINE_ID,
        cabin: CabinClass.Economy,
        seatsReserved: 1,
        freeBags: 1,
        maxBagKg: 23,
      },
    ],
    passengerCounts: { adults: 1, children: 0, infants: 1 },
    passengers: [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'A12345678',
        type: PassengerType.Adult,
        baggage: [{ segment: 0, bags: 2, weightKg: 40 }],
      },
      {
        fullName: 'Omar Ahmed',
        dateOfBirth: '2026-09-01',
        passportNumber: 'B98765432',
        type: PassengerType.Infant,
        baggage: [],
      },
    ],
    ...fields,
  }) as unknown as FlightBookingSource;

const flights = [
  {
    _id: OUTBOUND_ID,
    flightNumber: 'NP123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    // 14:30 in Cairo (UTC+3 in June) and 20:30 in New York (UTC-4).
    departureAt: new Date('2027-06-15T11:30:00.000Z'),
    arrivalAt: new Date('2027-06-16T00:30:00.000Z'),
  },
  {
    _id: RETURN_ID,
    flightNumber: 'NP124',
    departureAirport: 'JFK',
    arrivalAirport: 'CAI',
    departureAt: new Date('2027-06-22T22:05:00.000Z'),
    arrivalAt: new Date('2027-06-23T13:05:00.000Z'),
  },
];

const zones = new Map([
  ['CAI', 'Africa/Cairo'],
  ['JFK', 'America/New_York'],
]);

interface Chain {
  select: jest.Mock<Chain, []>;
  lean: jest.Mock<Chain, []>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const query = (result: unknown) => {
  const chain: Chain = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(() => Promise.resolve(result)),
  };
  return chain;
};

function setup(found: unknown) {
  const bookings = { findOne: jest.fn(() => query(found)) };
  const flightModel = { find: jest.fn(() => query(flights)) };
  const airlines = {
    findEntityOrThrow: jest.fn(() => Promise.resolve({ name: 'Nile Air' })),
  };
  const flightResponses = {
    timeZonesOf: jest.fn(() => Promise.resolve(zones)),
  };
  const seats = {
    findByBooking: jest.fn((..._args: unknown[]) =>
      Promise.resolve([
        {
          bookingId: BOOKING_ID,
          segmentIndex: 0,
          passengerIndex: 0,
          seatNumber: '12C',
        },
      ]),
    ),
  };
  const service = new FlightBookingETicketService(
    bookings as never,
    flightModel as never,
    airlines as unknown as AirlinesService,
    flightResponses as unknown as FlightResponsesService,
    seats as unknown as FlightSeatsService,
  );
  return { service, bookings, airlines, seats };
}

describe('FlightBookingETicketService (FLT-23)', () => {
  it("looks for the user's own booking and its chosen seats, and gives a PDF named after the reference", async () => {
    const { service, bookings, seats } = setup(booking());

    const file = await service.eTicket(
      BOOKING_ID.toString(),
      USER_ID.toString(),
    );

    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER_ID,
    });
    expect(file.filename).toBe('e-ticket-FB-7KQ2MX.pdf');
    expect(file.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(seats.findByBooking).toHaveBeenCalledWith(BOOKING_ID);
  });

  it("answers 404 for a missing booking or another user's, which the owner filter makes the same", async () => {
    const { service } = setup(null);

    await expect(
      service.eTicket(BOOKING_ID.toString(), USER_ID.toString()),
    ).rejects.toThrow(new NotFoundException(BOOKING_NOT_FOUND_MESSAGE));
  });

  it.each([
    FlightBookingStatus.PendingPayment,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Cancelled,
    FlightBookingStatus.Completed,
  ])('answers 409 for a %s booking', async (status) => {
    const { service, airlines } = setup(booking({ status }));

    await expect(
      service.eTicket(BOOKING_ID.toString(), USER_ID.toString()),
    ).rejects.toThrow(new ConflictException(E_TICKET_NOT_CONFIRMED_MESSAGE));
    expect(airlines.findEntityOrThrow).not.toHaveBeenCalled();
  });
});

describe('buildETicket (FLT-23)', () => {
  it('shows each time at its own airport with the zone and offset, from luxon', () => {
    const [leg] = buildETicket(
      booking(),
      'FB-7KQ2MX',
      flights,
      ['Nile Air'],
      zones,
      [],
    ).legs;

    expect(leg).toEqual({
      label: 'Outbound',
      airlineName: 'Nile Air',
      flightNumber: 'NP123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureLocal: '2027-06-15 14:30',
      departureTimeZone: 'Africa/Cairo',
      departureUtcOffset: '+03:00',
      arrivalLocal: '2027-06-15 20:30',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
      cabin: 'Economy',
      seats: 1,
      freeBaggage: '1 bag of up to 23 kg each',
    });
  });

  it('masks every passport to its last 3 characters, and names each type and their extra bags', () => {
    const ticket = buildETicket(
      booking(),
      'FB-7KQ2MX',
      flights,
      ['Nile Air'],
      zones,
      [],
    );

    expect(ticket.passengers).toEqual([
      {
        fullName: 'Sara Ahmed',
        type: 'Adult',
        passport: '*****678',
        extraBaggage: ['2 extra bags, 40 kg in total'],
        seats: ['seat not chosen yet'],
      },
      {
        fullName: 'Omar Ahmed',
        type: 'Infant',
        passport: '*****432',
        extraBaggage: ['no extra bags'],
        seats: ['no seat (infant)'],
      },
    ]);
    expect(JSON.stringify(ticket)).not.toContain('A12345678');
    expect(JSON.stringify(ticket)).not.toContain('B98765432');
  });

  it('shows the seats and the total paid from whole cents', () => {
    const ticket = buildETicket(
      booking(),
      'FB-7KQ2MX',
      flights,
      ['Nile Air'],
      zones,
      [],
    );

    expect(ticket.seats).toBe(1);
    expect(ticket.totalPaid).toBe('USD 525.75');
  });

  it('adds the return flight of a round trip, and each passenger’s bags on it', () => {
    const roundTrip = booking({
      segments: [
        ...booking().segments,
        {
          flightId: RETURN_ID,
          airlineId: AIRLINE_ID,
          cabin: CabinClass.Business,
          seatsReserved: 1,
        },
      ] as FlightBookingSource['segments'],
    });

    const ticket = buildETicket(
      roundTrip,
      'FB-7KQ2MX',
      flights,
      ['Nile Air', 'Delta Sky'],
      zones,
      [],
    );

    expect(ticket.legs[1]).toMatchObject({
      label: 'Return',
      airlineName: 'Delta Sky',
      departureLocal: '2027-06-22 18:05',
      cabin: 'Business',
      // A segment saved before PAY-02 has no copy of the free allowance.
      freeBaggage: 'not recorded',
    });
    expect(ticket.passengers[0].extraBaggage).toEqual([
      '2 extra bags, 40 kg in total',
      'no extra bags',
    ]);
  });

  it('shows the chosen seat of each passenger on each leg, and an infant none (FLT-28)', () => {
    const roundTrip = booking({
      segments: [
        ...booking().segments,
        {
          flightId: RETURN_ID,
          airlineId: AIRLINE_ID,
          cabin: CabinClass.Business,
          seatsReserved: 1,
        },
      ] as FlightBookingSource['segments'],
    });

    const ticket = buildETicket(
      roundTrip,
      'FB-7KQ2MX',
      flights,
      ['Nile Air', 'Delta Sky'],
      zones,
      [
        {
          bookingId: BOOKING_ID,
          segmentIndex: 1,
          passengerIndex: 0,
          seatNumber: '2C',
        },
        // Another passenger's seat never shows on Sara.
        {
          bookingId: BOOKING_ID,
          segmentIndex: 0,
          passengerIndex: 5,
          seatNumber: '1A',
        },
      ],
    );

    expect(ticket.passengers.map((passenger) => passenger.seats)).toEqual([
      ['seat not chosen yet', 'seat 2C'],
      ['no seat (infant)', 'no seat (infant)'],
    ]);
  });

  it('answers 404 when a flight of the booking is gone', () => {
    expect(() =>
      buildETicket(booking(), 'FB-7KQ2MX', [], ['Nile Air'], zones, []),
    ).toThrow(NotFoundException);
  });
});
