import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import type { FlightResponsesService } from '../flights/flight-responses.service';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { BookingType } from '../payments/enums/booking-type.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingGroup } from './enums/flight-booking-group.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { PassengerType } from './enums/passenger-type.enum';
import {
  FLIGHT_BOOKING_GROUPS,
  FlightBookingListService,
} from './flight-booking-list.service';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import type { FlightSeatsService } from './flight-seats.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90bbb';
const BOOKING_ID = '6740f1c2a4b5c6d7e8f90aaa';
const FLIGHT_A = new Types.ObjectId('6740f1c2a4b5c6d7e8f90111');
const FLIGHT_B = new Types.ObjectId('6740f1c2a4b5c6d7e8f90222');
const NOW = new Date('2027-01-01T12:00:00.000Z');

const stored = (flightIds: Types.ObjectId[]) => ({
  _id: new Types.ObjectId(BOOKING_ID),
  userId: new Types.ObjectId(USER_ID),
  reference: 'FB7K2Q9M',
  status: FlightBookingStatus.Confirmed,
  currency: 'USD',
  fareTotal: 25000,
  total: 25000,
  segments: flightIds.map((flightId) => ({
    flightId,
    cabin: CabinClass.Economy,
    fare: 25000,
    seatsReserved: 1,
  })),
  passengerCounts: { adults: 1, children: 0, infants: 0 },
  passengers: [],
  createdAt: new Date('2026-11-19T10:00:00.000Z'),
});

/** A stored booking with one adult and one infant (who takes no seat, FLT-12). */
const withPassengers = (flightIds: Types.ObjectId[]) => ({
  ...stored(flightIds),
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
      dateOfBirth: '2026-06-01',
      passportNumber: 'B12345678',
      type: PassengerType.Infant,
      baggage: [],
    },
  ],
});

/** The seat assignment of the adult of `withPassengers` on segment `segmentIndex`. */
const seat = (segmentIndex: number, seatNumber: string) => ({
  bookingId: new Types.ObjectId(BOOKING_ID),
  segmentIndex,
  passengerIndex: 0,
  seatNumber,
});

const response = (id: Types.ObjectId) => ({
  id: id.toString(),
  flightNumber: `F${id.toString().slice(-3)}`,
});

function setup(
  aggregated: unknown[] = [],
  found: unknown = null,
  refund: unknown = null,
  ownSeats: unknown[] = [],
) {
  const aggregate = jest.fn((..._args: unknown[]) => ({
    exec: () => Promise.resolve(aggregated),
  }));
  const bookings = {
    aggregate,
    findOne: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(found),
    })),
  };
  const flightsFind = jest.fn((..._args: unknown[]) => ({
    lean: jest.fn().mockReturnThis(),
    exec: () => Promise.resolve([{ _id: 'stored' }]),
  }));
  const flights = {
    collection: { collectionName: 'flights' },
    find: flightsFind,
  };
  const flightResponses = {
    toResponses: jest.fn((..._args: unknown[]) =>
      Promise.resolve([response(FLIGHT_A), response(FLIGHT_B)]),
    ),
  };
  const refunds = {
    findSummaryByBooking: jest.fn((..._args: unknown[]) =>
      Promise.resolve(refund),
    ),
  };
  const seats = {
    findByBooking: jest.fn((..._args: unknown[]) => Promise.resolve(ownSeats)),
    findByBookings: jest.fn((..._args: unknown[]) =>
      Promise.resolve(new Map([[BOOKING_ID, ownSeats]])),
    ),
  };
  const service = new FlightBookingListService(
    bookings as never,
    flights as never,
    flightResponses as unknown as FlightResponsesService,
    refunds as unknown as RefundsService,
    seats as unknown as FlightSeatsService,
  );
  return {
    service,
    aggregate,
    bookings,
    flightsFind,
    flightResponses,
    refunds,
    seats,
  };
}

const query = (fields: Record<string, unknown> = {}) =>
  plainToInstance(ListFlightBookingsQueryDto, fields);

describe('FLIGHT_BOOKING_GROUPS (FLT-25)', () => {
  it('upcoming: confirmed, or a hold that still lasts, with a flight still to depart, soonest first', () => {
    const rule = FLIGHT_BOOKING_GROUPS[FlightBookingGroup.Upcoming];

    expect(rule.statuses).toEqual([
      FlightBookingStatus.Confirmed,
      FlightBookingStatus.PendingPayment,
    ]);
    expect(rule.match(NOW)).toEqual({
      $or: [
        { status: FlightBookingStatus.Confirmed },
        { holdExpiresAt: { $gt: NOW } },
      ],
      lastDepartureAt: { $gt: NOW },
    });
    expect(rule.sort).toEqual({ firstDepartureAt: 1, _id: 1 });
  });

  it('past: completed, or confirmed with every flight departed, latest first', () => {
    const rule = FLIGHT_BOOKING_GROUPS[FlightBookingGroup.Past];

    expect(rule.statuses).toEqual([
      FlightBookingStatus.Confirmed,
      FlightBookingStatus.Completed,
    ]);
    expect(rule.match(NOW)).toEqual({
      $or: [
        { status: FlightBookingStatus.Completed },
        { lastDepartureAt: { $lte: NOW } },
      ],
    });
    expect(rule.sort).toEqual({ firstDepartureAt: -1, _id: -1 });
  });

  it('cancelled: every cancelled booking, latest cancellation first', () => {
    const rule = FLIGHT_BOOKING_GROUPS[FlightBookingGroup.Cancelled];

    expect(rule.statuses).toEqual([FlightBookingStatus.Cancelled]);
    expect(rule.match(NOW)).toEqual({});
    expect(rule.sort).toEqual({ cancelledAt: -1, _id: -1 });
  });

  it('never lists an expired hold', () => {
    for (const rule of Object.values(FLIGHT_BOOKING_GROUPS)) {
      expect(rule.statuses).not.toContain(FlightBookingStatus.Expired);
    }
  });
});

describe('FlightBookingListService.list (FLT-25)', () => {
  it('reads one page of the group in one aggregation of the user’s own bookings', async () => {
    const { service, aggregate } = setup([{ page: [], total: [] }]);

    await service.list(
      USER_ID,
      query({ group: 'past', page: 3, limit: 5 }),
      NOW,
    );

    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          userId: new Types.ObjectId(USER_ID),
          status: {
            $in: [FlightBookingStatus.Confirmed, FlightBookingStatus.Completed],
          },
        },
      },
      {
        $lookup: {
          from: 'flights',
          localField: 'segments.flightId',
          foreignField: '_id',
          pipeline: [{ $project: { departureAt: 1 } }],
          as: 'legs',
        },
      },
      {
        $addFields: {
          firstDepartureAt: { $min: '$legs.departureAt' },
          lastDepartureAt: { $max: '$legs.departureAt' },
        },
      },
      { $match: FLIGHT_BOOKING_GROUPS[FlightBookingGroup.Past].match(NOW) },
      { $sort: { firstDepartureAt: -1, _id: -1 } },
      {
        $facet: {
          page: [
            { $skip: 10 },
            { $limit: 5 },
            { $project: { legs: 0, firstDepartureAt: 0, lastDepartureAt: 0 } },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);
  });

  it('maps the page with its flights, read once, and counts the whole group', async () => {
    const { service, flightsFind, flightResponses } = setup([
      {
        page: [stored([FLIGHT_A, FLIGHT_B]), stored([FLIGHT_A])],
        total: [{ count: 7 }],
      },
    ]);

    const result = await service.list(USER_ID, query({ limit: 2 }), NOW);

    expect(flightsFind).toHaveBeenCalledTimes(1);
    expect(flightsFind).toHaveBeenCalledWith({
      _id: { $in: [FLIGHT_A, FLIGHT_B] },
    });
    expect(flightResponses.toResponses).toHaveBeenCalledWith(
      [{ _id: 'stored' }],
      NOW,
    );
    expect(result.meta).toEqual({ page: 1, limit: 2, total: 7, totalPages: 4 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: BOOKING_ID,
      reference: 'FB7K2Q9M',
      segments: [
        { flight: { id: FLIGHT_A.toString() } },
        { flight: { id: FLIGHT_B.toString() } },
      ],
    });
  });

  it('shows the chosen seats of each booking of the page, read in one query (FLT-28)', async () => {
    const page = [withPassengers([FLIGHT_A, FLIGHT_B])];
    const { service, seats } = setup(
      [{ page, total: [{ count: 1 }] }],
      null,
      null,
      [seat(1, '30F')],
    );

    const result = await service.list(USER_ID, query(), NOW);

    expect(seats.findByBookings).toHaveBeenCalledTimes(1);
    expect(seats.findByBookings).toHaveBeenCalledWith([page[0]._id]);
    expect(result.items[0].seats).toEqual([
      {
        segmentIndex: 0,
        flightId: FLIGHT_A.toString(),
        cabin: CabinClass.Economy,
        passengers: [{ passengerIndex: 0, seatNumber: null }],
      },
      {
        segmentIndex: 1,
        flightId: FLIGHT_B.toString(),
        cabin: CabinClass.Economy,
        passengers: [{ passengerIndex: 0, seatNumber: '30F' }],
      },
    ]);
  });

  it('answers an empty page without reading any flight', async () => {
    const { service, flightsFind } = setup([{ page: [], total: [] }]);

    await expect(service.list(USER_ID, query(), NOW)).resolves.toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    expect(flightsFind).not.toHaveBeenCalled();
  });

  it('treats an empty aggregation result as an empty page', async () => {
    const { service } = setup([]);

    await expect(service.list(USER_ID, query(), NOW)).resolves.toMatchObject({
      items: [],
      meta: { total: 0 },
    });
  });

  it('uses the current time by default', async () => {
    const { service, aggregate } = setup([{ page: [], total: [] }]);

    await service.list(USER_ID, query());

    const stages = aggregate.mock.calls[0][0] as { $match?: unknown }[];
    expect(JSON.stringify(stages[3])).toContain('lastDepartureAt');
  });
});

describe('FlightBookingListService.details (FLT-25)', () => {
  it('returns the owner’s booking with its flights and its refund', async () => {
    const refund = { id: 'refund-1' };
    const { service, bookings, refunds } = setup(
      [],
      stored([FLIGHT_A, FLIGHT_B]),
      refund,
    );

    const details = await service.details(BOOKING_ID, USER_ID, NOW);

    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID,
      userId: new Types.ObjectId(USER_ID),
    });
    expect(refunds.findSummaryByBooking).toHaveBeenCalledWith(
      BookingType.Flight,
      BOOKING_ID,
    );
    expect(details).toMatchObject({
      id: BOOKING_ID,
      flights: [response(FLIGHT_A), response(FLIGHT_B)],
      refund,
    });
  });

  it('shows the chosen seat of each passenger who takes one (FLT-28)', async () => {
    const booking = withPassengers([FLIGHT_A]);
    const { service, seats } = setup([], booking, null, [seat(0, '12C')]);

    const details = await service.details(BOOKING_ID, USER_ID, NOW);

    expect(seats.findByBooking).toHaveBeenCalledWith(booking._id);
    expect(details.seats).toEqual([
      {
        segmentIndex: 0,
        flightId: FLIGHT_A.toString(),
        cabin: CabinClass.Economy,
        passengers: [{ passengerIndex: 0, seatNumber: '12C' }],
      },
    ]);
  });

  it('answers 404 for a missing booking or another user’s, and reads nothing else', async () => {
    const { service, flightsFind, refunds, seats } = setup([], null);

    const error = await service
      .details(BOOKING_ID, USER_ID)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(BOOKING_NOT_FOUND_MESSAGE);
    expect(flightsFind).not.toHaveBeenCalled();
    expect(refunds.findSummaryByBooking).not.toHaveBeenCalled();
    expect(seats.findByBooking).not.toHaveBeenCalled();
  });
});
