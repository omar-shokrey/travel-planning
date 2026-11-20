import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from '../flight-bookings/enums/passenger-type.enum';
import type { AirlinesService } from './airlines.service';
import type { FlightResponsesService } from './flight-responses.service';
import {
  AIRLINE_VISIBLE_STATUSES,
  FlightPassengersService,
} from './flight-passengers.service';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { CabinClass } from './models/cabin-class.enum';

const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const NOW = new Date('2027-01-01T00:00:00.000Z');

const flight = (airlineId = AIRLINE_ID) => ({
  _id: new Types.ObjectId(FLIGHT_ID),
  airlineId,
  flightNumber: 'MS777',
  departureDateLocal: '2027-01-10',
});

const stored = (
  reference: string,
  status: FlightBookingStatus,
  names: string[],
) => ({
  _id: new Types.ObjectId(),
  reference,
  status,
  segments: [
    {
      flightId: new Types.ObjectId(FLIGHT_ID),
      cabin: CabinClass.Economy,
      seatsReserved: names.length,
    },
  ],
  passengers: names.map((fullName) => ({
    fullName,
    type: PassengerType.Adult,
  })),
});

function setup(found: unknown = flight(), bookings: unknown[] = []) {
  const select = jest.fn().mockReturnThis();
  const sort = jest.fn().mockReturnThis();
  const find = jest.fn((..._args: unknown[]) => ({
    select,
    sort,
    lean: jest.fn().mockReturnThis(),
    exec: () => Promise.resolve(bookings),
  }));
  const flights = {
    findById: jest.fn(() => ({
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(found),
    })),
  };
  const airlines = {
    findAssignedAirlineOrThrow: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ _id: AIRLINE_ID }),
    ),
  };
  const responses = {
    toResponse: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ id: FLIGHT_ID, cabins: [{ availableSeats: 7 }] }),
    ),
  };
  const service = new FlightPassengersService(
    flights as never,
    { find } as never,
    airlines as unknown as AirlinesService,
    responses as unknown as FlightResponsesService,
  );
  return { service, flights, find, select, sort, airlines, responses };
}

describe('FlightPassengersService.bookingsOf (FLT-29)', () => {
  it('returns the flight with its seats remaining and its paid bookings by reference', async () => {
    const { service, find, select, sort, airlines, responses } = setup(
      flight(),
      [
        stored('FB111111', FlightBookingStatus.Confirmed, ['A One', 'A Two']),
        stored('FB222222', FlightBookingStatus.Cancelled, ['B One']),
        stored('FB333333', FlightBookingStatus.Completed, ['C One']),
      ],
    );

    const result = await service.bookingsOf(FLIGHT_ID, 'moderator-1', NOW);

    expect(airlines.findAssignedAirlineOrThrow).toHaveBeenCalledWith(
      'moderator-1',
    );
    expect(find).toHaveBeenCalledWith({
      'segments.flightId': new Types.ObjectId(FLIGHT_ID),
      status: { $in: AIRLINE_VISIBLE_STATUSES },
    });
    expect(select).toHaveBeenCalledWith(
      'reference status segments passengers cancelledAt',
    );
    expect(sort).toHaveBeenCalledWith({ reference: 1 });
    expect(responses.toResponse).toHaveBeenCalledWith(flight(), NOW);
    expect(result.flight).toEqual({
      id: FLIGHT_ID,
      cabins: [{ availableSeats: 7 }],
    });
    expect(result.bookings.map((b) => [b.reference, b.status])).toEqual([
      ['FB111111', FlightBookingStatus.Confirmed],
      ['FB222222', FlightBookingStatus.Cancelled],
      ['FB333333', FlightBookingStatus.Completed],
    ]);
    // A cancelled booking's passenger does not fly.
    expect(result.passengerCount).toBe(3);
  });

  it('lists the paid statuses only: never a hold or an expired one', () => {
    expect(AIRLINE_VISIBLE_STATUSES).toEqual([
      FlightBookingStatus.Confirmed,
      FlightBookingStatus.Completed,
      FlightBookingStatus.Cancelled,
    ]);
  });

  it('answers 404 for a missing flight and reads no booking', async () => {
    const { service, find } = setup(null);

    const error = await service
      .bookingsOf(FLIGHT_ID, 'moderator-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
    expect(find).not.toHaveBeenCalled();
  });

  it('answers 403 for another airline’s flight and reads no booking', async () => {
    const { service, find } = setup(flight(new Types.ObjectId()));

    const error = await service
      .bookingsOf(FLIGHT_ID, 'moderator-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe(FOREIGN_FLIGHT_MESSAGE);
    expect(find).not.toHaveBeenCalled();
  });

  it('passes on the 403 of a moderator with no airline', async () => {
    const { service, airlines, flights } = setup();
    airlines.findAssignedAirlineOrThrow.mockRejectedValueOnce(
      new ForbiddenException('You are not assigned to an airline'),
    );

    await expect(service.bookingsOf(FLIGHT_ID, 'moderator-1')).rejects.toThrow(
      'You are not assigned to an airline',
    );
    expect(flights.findById).not.toHaveBeenCalled();
  });
});

describe('FlightPassengersService.passengerCsv (FLT-29)', () => {
  it('exports the passengers of the confirmed and completed bookings, named after the flight and date', async () => {
    const { service } = setup(flight(), [
      stored('FB111111', FlightBookingStatus.Confirmed, ['A One']),
      stored('FB222222', FlightBookingStatus.Cancelled, ['B One']),
      stored('FB333333', FlightBookingStatus.Completed, ['C One']),
    ]);

    const file = await service.passengerCsv(FLIGHT_ID, 'moderator-1');

    expect(file.filename).toBe('passengers-MS777-2027-01-10.csv');
    const text = file.csv.toString('utf8');
    expect(text).toContain('FB111111,A One,adult,economy,confirmed');
    expect(text).toContain('FB333333,C One,adult,economy,completed');
    expect(text).not.toContain('B One');
  });

  it('checks the airline first, like the list', async () => {
    const { service, find } = setup(flight(new Types.ObjectId()));

    await expect(
      service.passengerCsv(FLIGHT_ID, 'moderator-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(find).not.toHaveBeenCalled();
  });

  it('uses the current time by default for the flight response', async () => {
    const { service, responses } = setup();

    await service.bookingsOf(FLIGHT_ID, 'moderator-1');

    expect(responses.toResponse.mock.calls[0][1]).toBeInstanceOf(Date);
  });
});
