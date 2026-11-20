import type { FieldError } from '../common/interfaces/error-response.interface';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { CABIN_LABELS } from './booking-confirmation-message';
import type { SeatChoiceDto } from './dto/select-seats.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import type { PassengerType } from './enums/passenger-type.enum';
import {
  INFANT_SEAT_MESSAGE,
  SEATS_DEPARTED_MESSAGE,
  SEATS_FLIGHT_CANCELLED_MESSAGE,
  SEATS_NOT_CONFIRMED_MESSAGE,
  SEGMENT_INDEX_REQUIRED_MESSAGE,
  passengerIndexRangeMessage,
  seatNotOnMapMessage,
  segmentIndexRangeMessage,
} from './flight-bookings.constants';
import { needsSeat, type SeatRecord } from './mappers/booking-seats.mapper';
import type { CabinClass } from '../flights/models/cabin-class.enum';

/** The segment a request is about, or the 400 field error that refuses it. */
export type SegmentChoice =
  | { segmentIndex: number; error?: undefined }
  | { segmentIndex?: undefined; error: FieldError };

/**
 * FLT-28: which segment the seats are for. A one-way booking may leave
 * `segmentIndex` out (it is 0); a round trip must send it.
 */
export function resolveSegmentIndex(
  segmentCount: number,
  sent: number | undefined,
): SegmentChoice {
  if (sent === undefined) {
    return segmentCount === 1
      ? { segmentIndex: 0 }
      : {
          error: {
            field: 'segmentIndex',
            messages: [SEGMENT_INDEX_REQUIRED_MESSAGE],
          },
        };
  }
  return sent < segmentCount
    ? { segmentIndex: sent }
    : {
        error: {
          field: 'segmentIndex',
          messages: [segmentIndexRangeMessage(segmentCount)],
        },
      };
}

/** FLT-28: each chosen passenger exists and takes a seat (an infant takes none). */
export function passengerErrors(
  passengers: readonly { type: PassengerType }[],
  seats: readonly SeatChoiceDto[],
): FieldError[] {
  return seats.flatMap((seat, index) => {
    const field = `seats.${index}.passengerIndex`;
    const passenger = passengers[seat.passengerIndex];
    if (!passenger) {
      return [
        { field, messages: [passengerIndexRangeMessage(passengers.length)] },
      ];
    }
    return needsSeat(passenger.type)
      ? []
      : [{ field, messages: [INFANT_SEAT_MESSAGE] }];
  });
}

/** FLT-28: each chosen seat is on the seat map of the booked cabin. */
export function seatMapErrors(
  seatMap: ReadonlySet<string>,
  cabin: CabinClass,
  seats: readonly SeatChoiceDto[],
): FieldError[] {
  return seats.flatMap((seat, index) =>
    seatMap.has(seat.seatNumber)
      ? []
      : [
          {
            field: `seats.${index}.seatNumber`,
            messages: [
              seatNotOnMapMessage(seat.seatNumber, CABIN_LABELS[cabin]),
            ],
          },
        ],
  );
}

/** FLT-28: the 409 message when seats cannot be chosen for a booking in this status. */
export function bookingStateError(status: FlightBookingStatus): string | null {
  return status === FlightBookingStatus.Confirmed
    ? null
    : SEATS_NOT_CONFIRMED_MESSAGE;
}

/** FLT-28: the 409 message when the flight no longer takes seat choices. */
export function flightStateError(
  flight: { status: FlightStatus; departureAt: Date },
  now: Date,
): string | null {
  if (flight.status === FlightStatus.Cancelled) {
    return SEATS_FLIGHT_CANCELLED_MESSAGE;
  }
  if (
    flight.status !== FlightStatus.Scheduled ||
    flight.departureAt.getTime() <= now.getTime()
  ) {
    return SEATS_DEPARTED_MESSAGE;
  }
  return null;
}

/**
 * FLT-28: whether the passenger already holds this seat on this segment
 * when the request starts: asking for it again then writes nothing.
 */
export function holdsSeat(
  taken: readonly SeatRecord[],
  bookingId: string,
  segmentIndex: number,
  choice: SeatChoiceDto,
): boolean {
  return taken.some(
    (seat) =>
      seat.seatNumber === choice.seatNumber &&
      seat.bookingId.toString() === bookingId &&
      seat.segmentIndex === segmentIndex &&
      seat.passengerIndex === choice.passengerIndex,
  );
}

/**
 * FLT-28: whether a seat is held by anyone but this passenger when the
 * request starts. Every seat of a request must be free then, except the
 * passenger's own current seat, so two passengers of a booking cannot swap
 * seats in one request.
 */
export function isTakenByAnother(
  taken: readonly SeatRecord[],
  bookingId: string,
  segmentIndex: number,
  choice: SeatChoiceDto,
): boolean {
  const holder = taken.find((seat) => seat.seatNumber === choice.seatNumber);
  if (!holder) return false;
  return !(
    holder.bookingId.toString() === bookingId &&
    holder.segmentIndex === segmentIndex &&
    holder.passengerIndex === choice.passengerIndex
  );
}
