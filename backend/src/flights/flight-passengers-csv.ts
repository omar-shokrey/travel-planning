import type { FlightBookingOfFlightDto } from './dto/flight-bookings-response.dto';

/** The columns of the passenger list (FLT-29), in order. */
export const PASSENGER_CSV_HEADER = [
  'Reference',
  'Passenger',
  'Type',
  'Cabin',
  'Booking status',
] as const;

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line
 * break, with quotes doubled. A value that starts with `=`, `+`, `-`, `@`,
 * a tab or a carriage return gets a leading `'`, so a spreadsheet never runs
 * a passenger name as a formula (CSV injection).
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * FLT-29: the passenger list of a flight as CSV: a header, then one row per
 * passenger of each booking given, in order. Lines end with CRLF (RFC 4180)
 * and the file starts with a UTF-8 byte order mark, so spreadsheet programs
 * read accented names correctly.
 */
export function toPassengerCsv(
  bookings: readonly FlightBookingOfFlightDto[],
): string {
  const rows = [
    [...PASSENGER_CSV_HEADER],
    ...bookings.flatMap((booking) =>
      booking.passengers.map((passenger) => [
        booking.reference,
        passenger.fullName,
        passenger.type,
        booking.cabin,
        booking.status,
      ]),
    ),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}
