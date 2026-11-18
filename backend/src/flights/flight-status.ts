import type { QueryFilter } from 'mongoose';
import { FlightStatus } from './models/flight-status.enum';
import type { Flight } from './models/flight.schema';

/**
 * FLT-30: a flight has departed once its departure time has passed. At the
 * exact departure instant it counts as departed: FLT-03 refuses a departure
 * that is not strictly in the future, so both rules meet at the same instant
 * and no moment belongs to neither.
 */
export function hasDeparted(
  flight: Pick<Flight, 'departureAt'>,
  now: Date,
): boolean {
  return flight.departureAt.getTime() <= now.getTime();
}

/**
 * FLT-30: the status a flight has at `now`. `departed` is derived from the
 * departure time, never written by a timer: a stored `scheduled` flight whose
 * departure has passed is `departed`. A cancelled flight stays cancelled, even
 * after its departure time, and a stored `departed` stays departed.
 */
export function effectiveStatus(
  flight: Pick<Flight, 'status' | 'departureAt'>,
  now: Date,
): FlightStatus {
  return flight.status === FlightStatus.Scheduled && hasDeparted(flight, now)
    ? FlightStatus.Departed
    : flight.status;
}

/**
 * FLT-30: the one definition of "searchable, editable or bookable": stored as
 * `scheduled` and departing after `now`. Every query and every conditional
 * write that needs a scheduled flight puts this filter in the same operation,
 * so a flight that departs between a check and the write is never changed.
 */
export function scheduledFlightFilter(now: Date): QueryFilter<Flight> {
  return { status: FlightStatus.Scheduled, departureAt: { $gt: now } };
}
