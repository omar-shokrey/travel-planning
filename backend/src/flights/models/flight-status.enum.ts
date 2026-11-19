/**
 * The life of a flight (FLT-03, FLT-06, FLT-30). `scheduled` and `cancelled`
 * are stored; `departed` is derived from the departure time by
 * `effectiveStatus` (`flight-status.ts`), never written by a timer. Only
 * flights matching `scheduledFlightFilter(now)` are searchable, editable or
 * bookable.
 */
export enum FlightStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
  Departed = 'departed',
}
