import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { assertEditable } from './flight-editable';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { FlightStatus } from './models/flight-status.enum';

const NOW = new Date('2027-01-10T00:00:00.000Z');
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

const flight = (fields: Record<string, unknown> = {}) => ({
  airlineId: AIRLINE_ID,
  status: FlightStatus.Scheduled,
  departureAt: new Date(NOW.getTime() + 60_000),
  ...fields,
});

describe('assertEditable (FLT-04, FLT-05, FLT-30)', () => {
  it('lets a scheduled flight of the airline through', () => {
    expect(() => assertEditable(flight(), AIRLINE_ID, NOW)).not.toThrow();
  });

  it.each([
    ['no flight: 404', null, new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE)],
    [
      "another airline's flight: 403, before its status",
      flight({
        airlineId: new Types.ObjectId(),
        status: FlightStatus.Cancelled,
      }),
      new ForbiddenException(FOREIGN_FLIGHT_MESSAGE),
    ],
    [
      'a cancelled flight: 409',
      flight({ status: FlightStatus.Cancelled }),
      new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
    ],
    [
      'a departed flight: 409',
      flight({ status: FlightStatus.Departed }),
      new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
    ],
    [
      'a scheduled flight departing exactly now: 409',
      flight({ departureAt: NOW }),
      new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE),
    ],
  ])('answers %s', (_label, stored, answer) => {
    expect(() => assertEditable(stored, AIRLINE_ID, NOW)).toThrow(answer);
  });
});
