import type { Types } from 'mongoose';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { BookingType } from '../../payments/enums/booking-type.enum';
import {
  type AdminBookingStatus,
  UNKNOWN_PROVIDER_NAME,
  UNKNOWN_USER_NAME,
} from '../admin-bookings.constants';
import type {
  AdminBookingDatesDto,
  AdminBookingProviderDto,
  AdminBookingResponseDto,
  AdminBookingUserDto,
} from '../dto/admin-booking-response.dto';

/** The fields of a stored booking that both kinds share and the row needs. */
interface AdminBookingSourceBase {
  _id: Types.ObjectId;
  reference?: string | null;
  userId: Types.ObjectId;
  status: AdminBookingStatus;
  currency: string;
  total: number;
  createdAt: Date;
}

/** A stored flight booking, only the fields the row needs. */
export interface AdminFlightBookingSource extends AdminBookingSourceBase {
  type: BookingType.Flight;
  segments: { flightId: Types.ObjectId; airlineId: Types.ObjectId }[];
}

/** A stored hotel reservation, only the fields the row needs. */
export interface AdminHotelBookingSource extends AdminBookingSourceBase {
  type: BookingType.Hotel;
  hotelId: Types.ObjectId;
  checkIn: string;
  checkOut: string;
}

export type AdminBookingSource =
  AdminFlightBookingSource | AdminHotelBookingSource;

/** The records the rows of one page point to, by id (`_id.toString()`). */
export interface AdminBookingLookups {
  users: ReadonlyMap<string, { name: string; email: string }>;
  airlines: ReadonlyMap<string, { name: string }>;
  hotels: ReadonlyMap<string, { name: string }>;
  flights: ReadonlyMap<string, { departureAt: Date; arrivalAt: Date }>;
}

function toUser(
  userId: Types.ObjectId,
  lookups: AdminBookingLookups,
): AdminBookingUserDto {
  const id = userId.toString();
  const user = lookups.users.get(id);
  return {
    id,
    name: user?.name ?? UNKNOWN_USER_NAME,
    email: user?.email ?? null,
  };
}

/** The distinct airlines of the segments, in the order of the segments. */
function toAirlines(
  booking: AdminFlightBookingSource,
  lookups: AdminBookingLookups,
): AdminBookingProviderDto[] {
  const ids = [
    ...new Set(booking.segments.map(({ airlineId }) => airlineId.toString())),
  ];
  return ids.map((id) => ({
    type: ProviderType.Airline,
    id,
    name: lookups.airlines.get(id)?.name ?? UNKNOWN_PROVIDER_NAME,
  }));
}

/**
 * The first departure and the last arrival of the booking's flights, in UTC.
 * Both null if one of the flights cannot be found: a half trip would mislead.
 */
function toFlightDates(
  booking: AdminFlightBookingSource,
  lookups: AdminBookingLookups,
): AdminBookingDatesDto {
  const flights = booking.segments.map(({ flightId }) =>
    lookups.flights.get(flightId.toString()),
  );
  if (flights.length === 0 || flights.some((flight) => !flight)) {
    return { start: null, end: null };
  }
  const known = flights as { departureAt: Date; arrivalAt: Date }[];
  const start = Math.min(...known.map((f) => f.departureAt.getTime()));
  const end = Math.max(...known.map((f) => f.arrivalAt.getTime()));
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

/**
 * A stored flight booking or hotel reservation as a row of the admin list of
 * all bookings (ACC-17). Pure: the records it points to come in `lookups`,
 * and one that cannot be found never throws (see the admin README).
 */
export function toAdminBookingResponse(
  booking: AdminBookingSource,
  lookups: AdminBookingLookups,
): AdminBookingResponseDto {
  const common = {
    id: booking._id.toString(),
    type: booking.type,
    reference: booking.reference ?? null,
    status: booking.status,
    user: toUser(booking.userId, lookups),
  };
  const money = {
    amount: booking.total,
    currency: booking.currency,
    createdAt: booking.createdAt.toISOString(),
  };
  if (booking.type === BookingType.Flight) {
    return {
      ...common,
      providers: toAirlines(booking, lookups),
      dates: toFlightDates(booking, lookups),
      ...money,
    };
  }
  const hotelId = booking.hotelId.toString();
  return {
    ...common,
    providers: [
      {
        type: ProviderType.Hotel,
        id: hotelId,
        name: lookups.hotels.get(hotelId)?.name ?? UNKNOWN_PROVIDER_NAME,
      },
    ],
    dates: { start: booking.checkIn, end: booking.checkOut },
    ...money,
  };
}
