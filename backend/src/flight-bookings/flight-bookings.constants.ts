/** FLT-22: how long a Pending Payment booking holds its seats. */
export const FLIGHT_BOOKING_HOLD_MINUTES = 10;

/**
 * Seats (adults and children) in one booking. The workbook sets no maximum:
 * 9 is our limit, the usual airline limit for one booking.
 */
export const FLIGHT_BOOKING_SEATS_MAX = 9;

/** FLT-12: a booking needs at least one adult. */
export const FLIGHT_BOOKING_ADULTS_MIN = 1;

/** FLT-12: an infant occupies no seat and pays this share of the fare. */
export const INFANT_FARE_PERCENT = 10;

/** One segment for a one-way booking, two for a round trip (FLT-12): outbound, then return. */
export const FLIGHT_BOOKING_SEGMENTS_MAX = 2;

/**
 * FLT-22: how many due holds one run of the expiry job handles, oldest first.
 * The job runs every minute, so a larger backlog is cleared in a few runs.
 */
export const FLIGHT_BOOKING_EXPIRY_BATCH_SIZE = 100;

/**
 * FLT-19: most passengers in one booking. At most 9 seats (adults and
 * children) and no more infants than adults give at most 9 adults and 9
 * infants, so 18. Our limit, derived from the two rules above.
 */
export const FLIGHT_BOOKING_PASSENGERS_MAX = FLIGHT_BOOKING_SEATS_MAX * 2;

/**
 * FLT-19: a passenger's full name, 2 to 100 characters after trimming. The
 * workbook gives no length: these are our limits.
 */
export const PASSENGER_FULL_NAME_MIN_LENGTH = 2;
export const PASSENGER_FULL_NAME_MAX_LENGTH = 100;

/**
 * FLT-19: a passport or ID number is 5 to 20 letters and digits, stored in
 * upper case. The workbook gives no format: this is our rule.
 */
export const PASSPORT_NUMBER_MIN_LENGTH = 5;
export const PASSPORT_NUMBER_MAX_LENGTH = 20;
export const PASSPORT_NUMBER_PATTERN = /^[A-Z0-9]+$/;

/** FLT-19: a date of birth at most this many years back. Our limit. */
export const PASSENGER_MAX_AGE_YEARS = 120;

/** FLT-12(b): adult 12 or older, child 2 to 11, infant younger than 2, on the departure date. */
export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;

/** FLT-19: the answer when the flight's date or bag rule changed between the read and the hold. */
export const FLIGHT_CHANGED_MESSAGE =
  'The flight changed while booking. Try again.';

/**
 * FLT-12(a): every 404 and 409 about the return flight of a round trip is the
 * answer the outbound flight would get, prefixed so the user knows which leg.
 */
export const returnFlightMessage = (message: string): string =>
  `Return flight: ${message}`;

/** FLT-12(a): the return flight flies the outbound route back. */
export const returnRouteMessage = (from: string, to: string): string =>
  `The return flight must fly from ${to} to ${from}, the outbound route reversed`;

/** FLT-12(a): the return flight leaves after the outbound flight lands. */
export const RETURN_TOO_EARLY_MESSAGE =
  'The return flight must leave after the outbound flight arrives';

/** FLT-12(a): a cabin, or bags, for a return flight that was not sent. */
export const RETURN_CABIN_WITHOUT_FLIGHT_MESSAGE =
  'returnFlightId is required with returnCabin';
export const RETURN_FLIGHT_WITHOUT_CABIN_MESSAGE =
  'returnCabin is required with returnFlightId';
export const RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE =
  'returnExtraBags needs a return flight (returnFlightId)';

/**
 * FLT-12(b) on a round trip: the type is fixed on the outbound date (one type
 * per passenger, as stored), and an infant takes no seat. Someone who is an
 * infant outbound but 2 or older on the return date would need a seat there,
 * so the round trip is refused for them.
 */
export const INFANT_ON_RETURN_MESSAGE = `This passenger is an infant on the outbound flight but ${CHILD_MIN_AGE} or older on the return flight, where they need a seat: book two one-way trips`;

/** FLT-23: how many new references the confirmation tries when one is already taken. */
export const REFERENCE_ATTEMPTS = 5;

/** FLT-23: the e-ticket is only for a booking that is paid and confirmed. */
export const E_TICKET_NOT_CONFIRMED_MESSAGE =
  'Only a confirmed booking has an e-ticket';

/** FLT-26: the answers of a cancellation. */
export const NOT_CANCELLABLE_MESSAGE =
  'Only a confirmed booking can be cancelled';
export const DEPARTED_MESSAGE =
  'The flight has departed: the booking can no longer be cancelled';
/** FLT-06: the user cannot cancel what the airline's cancellation cancels with a full refund. */
export const FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE =
  'The airline cancelled this flight: the booking is cancelled and refunded in full';
export const REFUND_CHANGED_MESSAGE =
  'The refund changed since you viewed it. View the cancellation again and confirm the new refund';
/** GEN-11: how many confirmed bookings one run of the completion job completes, earliest trips first. */
export const FLIGHT_BOOKING_COMPLETION_BATCH_SIZE = 100;

/** FLT-06: how many bookings left on cancelled flights one run of the hourly sweep reads. */
export const FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE = 100;

/** FLT-28: the answers of seat selection. */
export const SEAT_TAKEN_MESSAGE = 'Seat already taken';
export const SEATS_NOT_CONFIRMED_MESSAGE =
  'Seats can only be chosen for a confirmed booking';
export const SEATS_DEPARTED_MESSAGE =
  'The flight has departed: seats can no longer be chosen';
export const SEATS_FLIGHT_CANCELLED_MESSAGE =
  'The airline cancelled this flight: seats can no longer be chosen';
export const SEGMENT_INDEX_REQUIRED_MESSAGE =
  'segmentIndex is required for a round trip: 0 is the outbound flight, 1 the return flight';
export const segmentIndexRangeMessage = (segments: number): string =>
  segments === 1
    ? 'segmentIndex must be 0: this booking has one flight'
    : `segmentIndex must be between 0 and ${segments - 1}`;
export const passengerIndexRangeMessage = (passengers: number): string =>
  `passengerIndex must be between 0 and ${passengers - 1}: the position of the passenger in the booking`;
export const INFANT_SEAT_MESSAGE =
  "An infant travels on an adult's lap and takes no seat";
export const seatNotOnMapMessage = (
  seatNumber: string,
  cabin: string,
): string => `Seat ${seatNumber} is not on the seat map of the ${cabin} cabin`;
/** FLT-28: how many times one seat claim is tried: once more after a race on the same passenger. */
export const SEAT_CLAIM_ATTEMPTS = 2;

/** FLT-27: the answers of a flight change. */
export const CHANGE_NOT_CONFIRMED_MESSAGE =
  'Only a confirmed booking can be changed';
export const CHANGE_DEPARTED_MESSAGE =
  'The flight has departed: it can no longer be changed';
export const SAME_FLIGHT_MESSAGE =
  'newFlightId must be another flight than the one booked';
export const changeRouteMessage = (from: string, to: string): string =>
  `The new flight must fly the same route: ${from} to ${to}`;
export const OUTBOUND_AFTER_RETURN_MESSAGE =
  'The new outbound flight must arrive before the return flight leaves';
export const CHANGE_AGE_GROUP_MESSAGE =
  'A passenger would be in another age group (adult, child or infant) on the new date: cancel the booking and book again';
export const CHANGE_BAGS_MESSAGE =
  "A passenger's extra bags are not allowed on the new flight (its airline sells no extra bags, fewer or lighter ones): choose another flight";
export const CHANGE_DIFFERENCE_CHANGED_MESSAGE =
  'The price difference changed since you viewed it. View the change again and confirm the new difference';
export const CHANGE_IN_PROGRESS_MESSAGE =
  'Another change of this booking is waiting for payment or in progress';
export const CHANGE_REFUND_TOO_LARGE_MESSAGE =
  'This change would refund more than what is left of the original payment: cancel the booking and book again';
export const CHANGE_BOOKING_CHANGED_MESSAGE =
  'The booking was changed or cancelled by another request. View it again';
export const POLICIES_REQUIRED_MESSAGE =
  "policiesAccepted must be true: accept the new airline's policies to change the flight";
export const EXPECTED_DIFFERENCE_REQUIRED_MESSAGE =
  'expectedDifference is required to change the flight: the difference the dry run showed';
/** FLT-27: how many flight changes one run of the change job handles, of each kind. */
export const FLIGHT_CHANGE_JOB_BATCH_SIZE = 100;
/** FLT-27: a change still `applying` this long after its last update is finished by the job. */
export const FLIGHT_CHANGE_STUCK_AFTER_MS = 2 * 60 * 1000;
