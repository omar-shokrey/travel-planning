import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import { SeatStatus } from './enums/seat-status.enum';
import type { FlightBookingListService } from './flight-booking-list.service';
import {
  CHANGE_BOOKING_CHANGED_MESSAGE,
  INFANT_SEAT_MESSAGE,
  SEATS_DEPARTED_MESSAGE,
  SEATS_FLIGHT_CANCELLED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEAT_TAKEN_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
} from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightSeatSelectionService } from './flight-seat-selection.service';
import type { FlightSeatsService } from './flight-seats.service';

const NOW = new Date('2027-01-01T12:00:00.000Z');
const BOOKING_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const OTHER_BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
const USER_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90bbb');
const OUT = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const BACK = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');
const DETAILS = { id: BOOKING_ID.toString(), seats: [] };

const passenger = (type: PassengerType) => ({
  fullName: `${type} passenger`,
  dateOfBirth: '1990-05-14',
  passportNumber: 'A12345678',
  type,
  baggage: [],
});

const stored = (fields: Record<string, unknown> = {}) => ({
  _id: BOOKING_ID,
  userId: USER_ID,
  status: FlightBookingStatus.Confirmed,
  segments: [{ flightId: OUT, cabin: CabinClass.Economy, seatsReserved: 2 }],
  passengers: [
    passenger(PassengerType.Adult),
    passenger(PassengerType.Child),
    passenger(PassengerType.Infant),
  ],
  ...fields,
});

const roundTrip = () =>
  stored({
    segments: [
      { flightId: OUT, cabin: CabinClass.Economy, seatsReserved: 2 },
      { flightId: BACK, cabin: CabinClass.Business, seatsReserved: 2 },
    ],
  });

const flight = (fields: Record<string, unknown> = {}) => ({
  _id: OUT,
  status: FlightStatus.Scheduled,
  departureAt: new Date('2027-02-01T08:00:00.000Z'),
  cabins: [{ cabin: CabinClass.Economy, totalSeats: 12 }],
  ...fields,
});

const chain = (value: unknown) => {
  const query = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn(() => Promise.resolve(value)),
  };
  query.select.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
};

function setup(
  booking: unknown = stored(),
  storedFlight: unknown = flight(),
  taken: unknown[] = [],
) {
  const bookings = {
    findOne: jest.fn((..._args: unknown[]) => chain(booking)),
    countDocuments: jest.fn((..._args: unknown[]) => ({
      exec: jest.fn((): Promise<number> => Promise.resolve(1)),
    })),
  };
  const flights = {
    findById: jest.fn((..._args: unknown[]) => chain(storedFlight)),
    find: jest.fn((..._args: unknown[]) =>
      chain(Array.isArray(storedFlight) ? storedFlight : [storedFlight]),
    ),
  };
  const seats = {
    takenOn: jest.fn((..._args: unknown[]): Promise<unknown[]> =>
      Promise.resolve(taken),
    ),
    claim: jest.fn((..._args: unknown[]): Promise<string | null> =>
      Promise.resolve(null),
    ),
    restore: jest.fn((..._args: unknown[]) => Promise.resolve()),
    findByBooking: jest.fn((..._args: unknown[]): Promise<unknown[]> =>
      Promise.resolve([]),
    ),
    releaseBooking: jest.fn((..._args: unknown[]) => Promise.resolve(1)),
    releaseSegment: jest.fn((..._args: unknown[]) => Promise.resolve(1)),
  };
  const lists = {
    details: jest.fn((..._args: unknown[]) => Promise.resolve(DETAILS)),
  };
  const service = new FlightSeatSelectionService(
    bookings as never,
    flights as never,
    seats as unknown as FlightSeatsService,
    lists as unknown as FlightBookingListService,
  );
  return { service, bookings, flights, seats, lists };
}

const select = (
  service: FlightSeatSelectionService,
  body: Record<string, unknown>,
) =>
  service
    .select(BOOKING_ID.toString(), USER_ID.toString(), body as never, NOW)
    .catch((error: unknown) => error);

/** The field errors of a 400. */
const fieldsOf = (error: unknown) =>
  (
    (error as BadRequestException).getResponse() as {
      errors: { field: string; messages: string[] }[];
    }
  ).errors;

describe('FlightSeatSelectionService.select (FLT-28)', () => {
  it("gives each passenger the seat, then answers the booking's details", async () => {
    const { service, bookings, seats, lists } = setup();

    const result = await select(service, {
      seats: [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1B' },
      ],
    });

    expect(result).toBe(DETAILS);
    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER_ID,
    });
    expect(seats.takenOn).toHaveBeenCalledWith(OUT, CabinClass.Economy);
    expect(seats.claim.mock.calls).toEqual([
      [
        {
          bookingId: BOOKING_ID,
          segmentIndex: 0,
          passengerIndex: 0,
          flightId: OUT,
          cabin: CabinClass.Economy,
          userId: USER_ID,
          seatNumber: '1A',
        },
      ],
      [expect.objectContaining({ passengerIndex: 1, seatNumber: '1B' })],
    ]);
    expect(lists.details).toHaveBeenCalledWith(
      BOOKING_ID.toString(),
      USER_ID.toString(),
      NOW,
    );
  });

  it('answers 404 for a missing booking or another user’s, and reads nothing else', async () => {
    const { service, flights, seats } = setup(null);

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    expect(flights.findById).not.toHaveBeenCalled();
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 400 when a round trip names no segment', async () => {
    const { service, seats } = setup(roundTrip());

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toBeInstanceOf(BadRequestException);
    expect(fieldsOf(error)).toEqual([
      { field: 'segmentIndex', messages: [SEGMENT_INDEX_REQUIRED_MESSAGE] },
    ]);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 400 for a segment a one-way booking does not have', async () => {
    const { service } = setup();

    const error = await select(service, {
      segmentIndex: 1,
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(fieldsOf(error)[0].field).toBe('segmentIndex');
  });

  it("reads the chosen segment's flight and cabin on a round trip", async () => {
    const { service, flights, seats } = setup(
      roundTrip(),
      flight({
        _id: BACK,
        cabins: [{ cabin: CabinClass.Business, totalSeats: 8 }],
      }),
    );

    await select(service, {
      segmentIndex: 1,
      seats: [{ passengerIndex: 0, seatNumber: '2C' }],
    });

    expect(flights.findById).toHaveBeenCalledWith(BACK);
    expect(seats.takenOn).toHaveBeenCalledWith(BACK, CabinClass.Business);
    expect(seats.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentIndex: 1,
        flightId: BACK,
        cabin: CabinClass.Business,
        seatNumber: '2C',
      }),
    );
  });

  it.each([
    FlightBookingStatus.PendingPayment,
    FlightBookingStatus.Cancelled,
    FlightBookingStatus.Expired,
    FlightBookingStatus.Completed,
  ])(
    'answers 409 for a %s booking, before reading the flight',
    async (status) => {
      const { service, flights } = setup(stored({ status }));

      const error = await select(service, {
        seats: [{ passengerIndex: 0, seatNumber: '1A' }],
      });

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(SEATS_NOT_CONFIRMED_MESSAGE);
      expect(flights.findById).not.toHaveBeenCalled();
    },
  );

  it('answers 409 "departed" when the flight no longer exists, as FLT-26 does', async () => {
    const { service, seats } = setup(stored(), null);

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SEATS_DEPARTED_MESSAGE);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('reads the booking again after the claims and answers its details while it is still confirmed', async () => {
    const { service, bookings, seats } = setup();

    await select(service, { seats: [{ passengerIndex: 0, seatNumber: '1A' }] });

    expect(bookings.countDocuments).toHaveBeenCalledWith(
      { _id: BOOKING_ID, status: FlightBookingStatus.Confirmed },
      { limit: 1 },
    );
    expect(bookings.countDocuments.mock.invocationCallOrder[0]).toBeGreaterThan(
      seats.claim.mock.invocationCallOrder[0],
    );
    expect(seats.releaseBooking).not.toHaveBeenCalled();
  });

  it('frees the seats of that segment and answers 409 when its flight was changed during the claims (FLT-27)', async () => {
    const { service, bookings, seats, lists } = setup();
    bookings.countDocuments
      .mockReturnValueOnce({
        exec: jest.fn((): Promise<number> => Promise.resolve(1)),
      })
      .mockReturnValueOnce({
        exec: jest.fn((): Promise<number> => Promise.resolve(0)),
      });

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toEqual(
      new ConflictException(CHANGE_BOOKING_CHANGED_MESSAGE),
    );
    expect(bookings.countDocuments).toHaveBeenLastCalledWith(
      { _id: BOOKING_ID, 'segments.0.flightId': expect.anything() },
      { limit: 1 },
    );
    expect(seats.releaseSegment).toHaveBeenCalledWith(BOOKING_ID, 0);
    expect(seats.releaseBooking).not.toHaveBeenCalled();
    expect(lists.details).not.toHaveBeenCalled();
  });

  it('frees the seats it gave and answers 409 when the booking was cancelled during the claims', async () => {
    const { service, bookings, seats, lists } = setup();
    bookings.countDocuments.mockReturnValueOnce({
      exec: jest.fn((): Promise<number> => Promise.resolve(0)),
    });

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SEATS_NOT_CONFIRMED_MESSAGE);
    expect(seats.releaseBooking).toHaveBeenCalledWith(BOOKING_ID);
    expect(lists.details).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: FlightStatus.Cancelled }, SEATS_FLIGHT_CANCELLED_MESSAGE],
    [{ status: FlightStatus.Departed }, SEATS_DEPARTED_MESSAGE],
    [{ departureAt: NOW }, SEATS_DEPARTED_MESSAGE],
  ])('answers 409 for the flight %p', async (fields, message) => {
    const { service, seats } = setup(stored(), flight(fields));

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(message);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 400 for an infant and for a passenger the booking does not have', async () => {
    const { service, seats } = setup();

    const error = await select(service, {
      seats: [
        { passengerIndex: 2, seatNumber: '1A' },
        { passengerIndex: 7, seatNumber: '1B' },
      ],
    });

    expect(fieldsOf(error)).toEqual([
      { field: 'seats.0.passengerIndex', messages: [INFANT_SEAT_MESSAGE] },
      {
        field: 'seats.1.passengerIndex',
        messages: [expect.stringContaining('between 0 and 2')],
      },
    ]);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 400 for a seat that is not on the seat map of the cabin', async () => {
    const { service, seats } = setup();

    // 12 economy seats: rows 1 and 2, A to F.
    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '3A' }],
    });

    expect(fieldsOf(error)).toEqual([
      {
        field: 'seats.0.seatNumber',
        messages: ['Seat 3A is not on the seat map of the Economy cabin'],
      },
    ]);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 400 for every seat when the flight no longer has the booked cabin', async () => {
    const { service } = setup(stored(), flight({ cabins: [] }));

    const error = await select(service, {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(fieldsOf(error)[0].field).toBe('seats.0.seatNumber');
  });

  it('answers 409 "Seat already taken" before any claim when another booking holds a seat', async () => {
    const { service, seats } = setup(stored(), flight(), [
      {
        bookingId: OTHER_BOOKING,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1B',
      },
    ]);

    const error = await select(service, {
      seats: [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1B' },
      ],
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(SEAT_TAKEN_MESSAGE);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('answers 409 for a swap of two passengers of the booking in one request', async () => {
    const { service, seats } = setup(stored(), flight(), [
      {
        bookingId: BOOKING_ID,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1A',
      },
      {
        bookingId: BOOKING_ID,
        segmentIndex: 0,
        passengerIndex: 1,
        seatNumber: '1B',
      },
    ]);

    const error = await select(service, {
      seats: [
        { passengerIndex: 0, seatNumber: '1B' },
        { passengerIndex: 1, seatNumber: '1A' },
      ],
    });

    expect((error as Error).message).toBe(SEAT_TAKEN_MESSAGE);
    expect(seats.claim).not.toHaveBeenCalled();
  });

  it('writes nothing for a passenger who asks again for the seat they hold, and still moves the others', async () => {
    const { service, seats } = setup(stored(), flight(), [
      {
        bookingId: BOOKING_ID,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1A',
      },
    ]);

    await expect(
      select(service, {
        seats: [
          { passengerIndex: 0, seatNumber: '1A' },
          { passengerIndex: 1, seatNumber: '1B' },
        ],
      }),
    ).resolves.toBe(DETAILS);
    expect(seats.claim).toHaveBeenCalledTimes(1);
    expect(seats.claim).toHaveBeenCalledWith(
      expect.objectContaining({ passengerIndex: 1, seatNumber: '1B' }),
    );
    expect(seats.restore).not.toHaveBeenCalled();
  });

  it('all or nothing: when a later claim loses a race, the passengers already moved get their seats back', async () => {
    const { service, seats } = setup();
    const lost = new ConflictException(SEAT_TAKEN_MESSAGE);
    seats.claim
      .mockResolvedValueOnce('2F') // passenger 0 had 2F
      .mockResolvedValueOnce(null) // passenger 1 had no seat
      .mockRejectedValueOnce(lost);
    const body = {
      seats: [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1B' },
        { passengerIndex: 0, seatNumber: '1C' },
      ],
    };

    // The DTO refuses a passenger named twice; here only the order matters.
    const error = await select(service, body);

    expect(error).toBe(lost);
    expect(seats.restore.mock.calls).toEqual([
      [
        { bookingId: BOOKING_ID, segmentIndex: 0, passengerIndex: 1 },
        '1B',
        null,
      ],
      [
        { bookingId: BOOKING_ID, segmentIndex: 0, passengerIndex: 0 },
        '1A',
        '2F',
      ],
    ]);
  });

  it('restores nothing for a passenger whose claim changed nothing', async () => {
    const { service, seats } = setup();
    seats.claim
      .mockResolvedValueOnce('1A') // already had it
      .mockRejectedValueOnce(new ConflictException(SEAT_TAKEN_MESSAGE));

    await select(service, {
      seats: [
        { passengerIndex: 0, seatNumber: '1A' },
        { passengerIndex: 1, seatNumber: '1B' },
      ],
    });

    expect(seats.restore).not.toHaveBeenCalled();
  });

  it('uses the current time by default', async () => {
    const { service, lists } = setup();

    await service.select(BOOKING_ID.toString(), USER_ID.toString(), {
      seats: [{ passengerIndex: 0, seatNumber: '1A' }],
    });

    expect(lists.details.mock.calls[0][2]).toBeInstanceOf(Date);
  });
});

describe('FlightSeatSelectionService.seatMap (FLT-28)', () => {
  it("shows each segment's cabin with the seats held, and each passenger's seat", async () => {
    const { service, flights, seats } = setup(stored(), [
      flight({ cabins: [{ cabin: CabinClass.Economy, totalSeats: 3 }] }),
    ]);
    seats.takenOn.mockResolvedValueOnce([
      {
        bookingId: BOOKING_ID,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1A',
      },
      {
        bookingId: OTHER_BOOKING,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1C',
      },
    ]);
    seats.findByBooking.mockResolvedValueOnce([
      {
        bookingId: BOOKING_ID,
        segmentIndex: 0,
        passengerIndex: 0,
        seatNumber: '1A',
      },
    ]);

    const map = await service.seatMap(
      BOOKING_ID.toString(),
      USER_ID.toString(),
    );

    expect(flights.find).toHaveBeenCalledWith({ _id: { $in: [OUT] } });
    expect(seats.findByBooking).toHaveBeenCalledWith(BOOKING_ID);
    expect(map.segments[0].seats).toEqual([
      { seatNumber: '1A', status: SeatStatus.Yours },
      { seatNumber: '1B', status: SeatStatus.Available },
      { seatNumber: '1C', status: SeatStatus.Taken },
    ]);
    expect(map.passengers[0].seats).toEqual(['1A']);
  });

  it('shows an empty map for a flight that is gone or has no such cabin', async () => {
    const { service } = setup(roundTrip(), [
      flight({ cabins: [{ cabin: CabinClass.First, totalSeats: 4 }] }),
    ]);

    const map = await service.seatMap(
      BOOKING_ID.toString(),
      USER_ID.toString(),
    );

    expect(map.segments.map((segment) => segment.seats)).toEqual([[], []]);
  });

  it('answers 404 for a missing booking or another user’s', async () => {
    const { service, seats } = setup(null);

    const error = await service
      .seatMap(BOOKING_ID.toString(), USER_ID.toString())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    expect(seats.takenOn).not.toHaveBeenCalled();
  });
});
