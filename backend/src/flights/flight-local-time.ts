import { DateTime } from 'luxon';

/** GEN-06: a moment as the clocks show it at one airport. */
export interface LocalTime {
  /**
   * The wall-clock time in the zone, `YYYY-MM-DDTHH:mm`: the format a
   * moderator types for `departureLocal` and `arrivalLocal` (FLT-03), so what
   * was entered comes back unchanged.
   */
  local: string;
  /** The IANA time zone, for example `Africa/Cairo`. */
  timeZone: string;
  /** The offset from UTC at that moment, `+HH:MM` or `-HH:MM`. */
  utcOffset: string;
}

/** The format of `LocalTime.local`, the same as the create input without seconds. */
const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";

/**
 * GEN-06: a UTC moment in an airport's IANA time zone, converted by luxon
 * (never by adding hours). The offset is the zone's offset at that moment,
 * so it follows daylight saving. An unknown zone throws: no user input
 * reaches this, so it means the reference data is broken.
 */
export function toLocalTime(instant: Date, timeZone: string): LocalTime {
  const time = DateTime.fromJSDate(instant, { zone: timeZone });
  if (!time.isValid) {
    throw new Error(`Unknown time zone "${timeZone}"`);
  }
  return {
    local: time.toFormat(LOCAL_FORMAT),
    timeZone,
    utcOffset: time.toFormat('ZZ'),
  };
}
