import type {
  SeatMapResponseDto,
  SegmentSeatsResponseDto,
} from '../dto/booking-seats-response.dto';
import { PassengerType } from '../enums/passenger-type.enum';
import { SeatStatus } from '../enums/seat-status.enum';
import type { SeatAssignmentSource } from '../flight-seats.service';
import type { FlightBookingSource } from './flight-booking.mapper';

/** What the mappers read of a seat assignment. */
export type SeatRecord = Pick<
  SeatAssignmentSource,
  'bookingId' | 'segmentIndex' | 'passengerIndex' | 'seatNumber'
>;

/** FLT-12: adults and children take a seat; an infant travels on a lap. */
export const needsSeat = (type: PassengerType): boolean =>
  type !== PassengerType.Infant;

const seatOf = (
  seats: readonly SeatRecord[],
  segmentIndex: number,
  passengerIndex: number,
): string | null =>
  seats.find(
    (seat) =>
      seat.segmentIndex === segmentIndex &&
      seat.passengerIndex === passengerIndex,
  )?.seatNumber ?? null;

/**
 * FLT-28: the seats of a booking, one entry per segment, with every passenger
 * who takes a seat and the seat they hold (null when none is chosen).
 * `seats` are the booking's own assignments.
 */
export function toSegmentSeats(
  booking: FlightBookingSource,
  seats: readonly SeatRecord[],
): SegmentSeatsResponseDto[] {
  const passengers = booking.passengers ?? [];
  return booking.segments.map((segment, segmentIndex) => ({
    segmentIndex,
    flightId: segment.flightId.toString(),
    cabin: segment.cabin,
    passengers: passengers.flatMap((passenger, passengerIndex) =>
      needsSeat(passenger.type)
        ? [
            {
              passengerIndex,
              seatNumber: seatOf(seats, segmentIndex, passengerIndex),
            },
          ]
        : [],
    ),
  }));
}

/** The seat map of one segment's cabin and every seat taken on it. */
export interface SegmentSeatMap {
  /** buildSeatMap of the cabin, in order. */
  seatNumbers: readonly string[];
  /** Every assignment of that flight and cabin, this booking's included. */
  taken: readonly SeatRecord[];
}

/**
 * FLT-28: the seat map of a booking for its owner. A seat held by this
 * booking is `yours`, one held by anyone else `taken` (never who), the rest
 * `available`. `segmentMaps` follow the booking's segments; `ownSeats` are
 * the booking's assignments. A seat the booking holds that is no longer on
 * the map (the cabin got fewer seats, FLT-05) still shows on its passenger.
 */
export function toSeatMap(
  booking: FlightBookingSource,
  segmentMaps: readonly SegmentSeatMap[],
  ownSeats: readonly SeatRecord[],
): SeatMapResponseDto {
  const bookingId = booking._id.toString();
  return {
    bookingId,
    segments: booking.segments.map((segment, segmentIndex) => {
      const map = segmentMaps[segmentIndex];
      const holder = new Map(
        (map?.taken ?? []).map((seat) => [
          seat.seatNumber,
          seat.bookingId.toString(),
        ]),
      );
      return {
        segmentIndex,
        flightId: segment.flightId.toString(),
        cabin: segment.cabin,
        seats: (map?.seatNumbers ?? []).map((seatNumber) => {
          const heldBy = holder.get(seatNumber);
          let status = SeatStatus.Available;
          if (heldBy === bookingId) status = SeatStatus.Yours;
          else if (heldBy !== undefined) status = SeatStatus.Taken;
          return { seatNumber, status };
        }),
      };
    }),
    passengers: (booking.passengers ?? []).map((passenger, passengerIndex) => ({
      passengerIndex,
      fullName: passenger.fullName,
      type: passenger.type,
      needsSeat: needsSeat(passenger.type),
      seats: booking.segments.map((_segment, segmentIndex) =>
        needsSeat(passenger.type)
          ? seatOf(ownSeats, segmentIndex, passengerIndex)
          : null,
      ),
    })),
  };
}
