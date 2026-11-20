import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AirlinesService } from './airlines.service';
import type { FlightBookingLookup } from './flight-booking-lookup.service';
import type { FlightResponsesService } from './flight-responses.service';
import {
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_CANCELLABLE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { FlightsService } from './flights.service';
import { FlightStatus } from './models/flight-status.enum';

const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const NOW = new Date('2027-01-01T00:00:00.000Z');
const LATER = new Date('2027-01-10T08:00:00.000Z');

function setup(cancelled: unknown, current: unknown = null) {
  const flights = {
    findOneAndUpdate: jest.fn((..._args: unknown[]) => ({
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(cancelled),
    })),
    findById: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(current),
    })),
  };
  const airlines = {
    findAssignedAirlineOrThrow: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ _id: AIRLINE_ID }),
    ),
  };
  const service = new FlightsService(
    flights as never,
    airlines as unknown as AirlinesService,
    {} as FlightResponsesService,
    {} as FlightBookingLookup,
    {} as NotificationsService,
  );
  return { service, flights, airlines };
}

const stored = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(FLIGHT_ID),
  airlineId: AIRLINE_ID,
  status: FlightStatus.Scheduled,
  departureAt: LATER,
  ...fields,
});

async function failure(call: Promise<unknown>): Promise<Error> {
  return (await call.catch((e: unknown) => e)) as Error;
}

describe('FlightsService.cancel (FLT-06)', () => {
  it('cancels with one update matching the moderator’s airline and a flight still scheduled', async () => {
    const after = stored({ status: FlightStatus.Cancelled });
    const { service, flights, airlines } = setup(after);

    await expect(service.cancel(FLIGHT_ID, 'moderator-1', NOW)).resolves.toBe(
      after,
    );

    expect(airlines.findAssignedAirlineOrThrow).toHaveBeenCalledWith(
      'moderator-1',
    );
    expect(flights.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: FLIGHT_ID,
        airlineId: AIRLINE_ID,
        status: FlightStatus.Scheduled,
        departureAt: { $gt: NOW },
      },
      { $set: { status: FlightStatus.Cancelled } },
      { returnDocument: 'after' },
    );
    expect(flights.findById).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing flight', async () => {
    const { service } = setup(null, null);

    const error = await failure(service.cancel(FLIGHT_ID, 'moderator-1', NOW));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FLIGHT_NOT_FOUND_MESSAGE);
  });

  it('answers 403 for another airline’s flight', async () => {
    const { service } = setup(
      null,
      stored({ airlineId: new Types.ObjectId() }),
    );

    const error = await failure(service.cancel(FLIGHT_ID, 'moderator-1', NOW));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(FOREIGN_FLIGHT_MESSAGE);
  });

  it.each([
    ['already cancelled', { status: FlightStatus.Cancelled }],
    ['departed', { status: FlightStatus.Departed }],
    ['past its departure time', { departureAt: new Date(NOW.getTime() - 1) }],
  ])('answers 409 for a flight %s', async (_case, fields) => {
    const { service } = setup(null, stored(fields));

    const error = await failure(service.cancel(FLIGHT_ID, 'moderator-1', NOW));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(FLIGHT_NOT_CANCELLABLE_MESSAGE);
  });

  it('answers 409 "changed" when it is scheduled again on the second read', async () => {
    const { service } = setup(null, stored());

    const error = await failure(service.cancel(FLIGHT_ID, 'moderator-1', NOW));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(FLIGHT_CHANGED_MESSAGE);
  });

  it('passes on the 403 of a moderator with no airline, before any write', async () => {
    const { service, flights, airlines } = setup(null);
    airlines.findAssignedAirlineOrThrow.mockRejectedValueOnce(
      new ForbiddenException('You are not assigned to an airline'),
    );

    await expect(service.cancel(FLIGHT_ID, 'moderator-1')).rejects.toThrow(
      'You are not assigned to an airline',
    );
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('uses the current time by default', async () => {
    const { service, flights } = setup(
      stored({ status: FlightStatus.Cancelled }),
    );

    await service.cancel(FLIGHT_ID, 'moderator-1');

    const filter = flights.findOneAndUpdate.mock.calls[0][0] as {
      departureAt: { $gt: Date };
    };
    expect(filter.departureAt.$gt).toBeInstanceOf(Date);
  });
});
