/** The life of a flight (FLT-03, FLT-06, FLT-30). Only `scheduled` flights are searchable, editable or bookable. */
export enum FlightStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
  Departed = 'departed',
}
