import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Types } from 'mongoose';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { effectiveStatus } from './flight-status';
import { FlightStatus } from './models/flight-status.enum';
import type { Flight } from './models/flight.schema';

/** What every check of a change reads of a flight. */
export type EditableFlight = Pick<
  Flight,
  'airlineId' | 'status' | 'departureAt'
>;

/**
 * The checks every change of a flight shares (FLT-04 cabins, FLT-05 edit), in
 * this order: the flight exists (404), it belongs to the moderator's airline
 * (403), it is scheduled at `now` (409): not cancelled, not departed, and its
 * departure time has not passed (FLT-30). The write repeats the last two in
 * its own filter; this function tells the client why a write cannot match.
 */
export function assertEditable<T extends EditableFlight>(
  flight: T | null,
  airlineId: Types.ObjectId,
  now: Date,
): asserts flight is T {
  if (!flight) {
    throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
  }
  if (!flight.airlineId.equals(airlineId)) {
    throw new ForbiddenException(FOREIGN_FLIGHT_MESSAGE);
  }
  if (effectiveStatus(flight, now) !== FlightStatus.Scheduled) {
    throw new ConflictException(FLIGHT_NOT_SCHEDULED_MESSAGE);
  }
}
