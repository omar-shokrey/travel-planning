import { RoomNightState } from './models/room-night-state.enum';
import { coversNight, nightsOf, type DateRange } from './room-dates';

/** The status of one night of a room, as the moderator sees it (HTL-08). */
export enum RoomStatus {
  /** Bookable, and nobody has it. */
  Available = 'available',
  /** A reservation has it: Confirmed, or Pending Payment while its hold lasts. */
  Booked = 'booked',
  /** The moderator blocked it (HTL-06). */
  Blocked = 'blocked',
  /** Outside every availability range of the room (HTL-04), so not bookable. */
  Unavailable = 'unavailable',
}

/** A stored `room_nights` document, as much as the status needs. */
export interface StoredNight {
  date: string;
  state: RoomNightState;
  bookingId?: string;
  holdExpiresAt?: Date;
}

/** Consecutive nights with the same status and the same reservation. */
export interface RoomStatusSegment extends DateRange {
  status: RoomStatus;
  /** Only when booked: the reservation that has the nights. */
  bookingId?: string;
  /** Only when booked: true while the reservation waits for payment. */
  pendingPayment?: boolean;
}

/** The status of one night, or `null` for a night with no stored document. */
const statusOf = (
  night: StoredNight,
  now: Date,
): Omit<RoomStatusSegment, 'from' | 'to'> | null => {
  switch (night.state) {
    case RoomNightState.Blocked:
      return { status: RoomStatus.Blocked };
    case RoomNightState.Booked:
      return {
        status: RoomStatus.Booked,
        bookingId: night.bookingId,
        pendingPayment: false,
      };
    case RoomNightState.Held:
      // A hold whose time has passed no longer counts, as for every query.
      return night.holdExpiresAt && night.holdExpiresAt > now
        ? {
            status: RoomStatus.Booked,
            bookingId: night.bookingId,
            pendingPayment: true,
          }
        : null;
  }
};

const sameSegment = (
  a: Omit<RoomStatusSegment, 'from' | 'to'>,
  b: Omit<RoomStatusSegment, 'from' | 'to'>,
): boolean =>
  a.status === b.status &&
  a.bookingId === b.bookingId &&
  a.pendingPayment === b.pendingPayment;

/**
 * HTL-08: the status of every night of `range` for one room, with consecutive
 * nights of the same status (and the same reservation) joined into one
 * segment. `to` of a segment is the day after its last night, as in HTL-04.
 */
export function roomStatusSegments(
  range: DateRange,
  availability: readonly DateRange[],
  nights: readonly StoredNight[],
  now: Date,
): RoomStatusSegment[] {
  const stored = new Map(nights.map((night) => [night.date, night]));
  const dates = nightsOf(range);
  const segments: RoomStatusSegment[] = [];

  dates.forEach((date, index) => {
    const night = stored.get(date);
    const fromNight = night ? statusOf(night, now) : null;
    const status = fromNight ?? {
      status: coversNight(availability, date)
        ? RoomStatus.Available
        : RoomStatus.Unavailable,
    };
    const to = dates[index + 1] ?? range.to;

    const last = segments[segments.length - 1];
    if (last && sameSegment(last, status)) {
      last.to = to;
    } else {
      segments.push({ from: date, to, ...status });
    }
  });

  return segments;
}
