import { type LocalTime, toLocalTime } from './flight-local-time';

/** A flight's times and where they are shown, before or after an edit. */
export interface FlightSchedule {
  departureAirport: string;
  arrivalAirport: string;
  departureAt: Date;
  arrivalAt: Date;
  /** The IANA time zone of the departure airport. */
  departureZone: string;
  /** The IANA time zone of the arrival airport. */
  arrivalZone: string;
}

/**
 * The minute of an instant. Every response and every notification shows a
 * flight's times to the minute (GEN-06), so a time "changes" for a passenger
 * only when its minute changes: moving 14:30:45 to 14:30 is not a new time.
 */
export const minuteOf = (instant: Date): number =>
  Math.floor(instant.getTime() / 60_000);

/** A local time as the message shows it, `YYYY-MM-DD HH:mm`. */
const clock = (time: LocalTime): string => time.local.replace('T', ' ');

/**
 * One line of the message: the new local time, and the old one when the
 * instant changed (to the minute, as `minuteOf`). When the clocks go back, two
 * instants an hour apart show the same clock time; the line then adds each
 * one's UTC offset, so the passenger sees which 01:30 it is.
 */
function line(
  label: string,
  airport: string,
  before: { instant: Date; zone: string },
  after: { instant: Date; zone: string },
): string {
  const now = toLocalTime(after.instant, after.zone);
  if (minuteOf(before.instant) === minuteOf(after.instant)) {
    return `${label}: ${clock(now)} ${airport} time (unchanged).`;
  }
  const was = toLocalTime(before.instant, before.zone);
  return clock(now) === clock(was)
    ? `${label}: ${clock(now)} ${airport} time, UTC${now.utcOffset} (was ${clock(was)}, UTC${was.utcOffset}).`
    : `${label}: ${clock(now)} ${airport} time (was ${clock(was)}).`;
}

/**
 * The text of the in-app notification about a time change (FLT-05, GEN-01):
 * the flight number, the route, and the old and new times, each in the local
 * time of its airport (GEN-06), so the passenger reads the clocks they will
 * see. For example: "Flight MS123 from CAI to JFK has new times. Departure:
 * 2027-06-15 16:30 CAI time (was 2027-06-15 14:30). Arrival: 2027-06-15 20:30
 * JFK time (unchanged)."
 */
export function flightTimeChangeMessage(
  flightNumber: string,
  before: FlightSchedule,
  after: FlightSchedule,
): string {
  return [
    `Flight ${flightNumber} from ${after.departureAirport} to ${after.arrivalAirport} has new times.`,
    line(
      'Departure',
      after.departureAirport,
      { instant: before.departureAt, zone: before.departureZone },
      { instant: after.departureAt, zone: after.departureZone },
    ),
    line(
      'Arrival',
      after.arrivalAirport,
      { instant: before.arrivalAt, zone: before.arrivalZone },
      { instant: after.arrivalAt, zone: after.arrivalZone },
    ),
  ].join(' ');
}
