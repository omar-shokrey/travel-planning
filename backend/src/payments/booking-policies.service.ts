import { ConflictException, Injectable } from '@nestjs/common';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import type { FlightBookingSource } from '../flight-bookings/mappers/flight-booking.mapper';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import type { HotelBookingSource } from '../hotel-bookings/mappers/hotel-booking.mapper';
import type {
  BookingPoliciesResponseDto,
  PayableBooking,
} from './dto/booking-policies-response.dto';
import { type BookingKind, BookingType } from './enums/booking-type.enum';
import {
  toFlightBookingPolicies,
  toHotelBookingPolicies,
} from './mappers/booking-policies.mapper';
import {
  BOOKING_CHANGED_MESSAGE,
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  PENDING_PAYMENT,
  POLICIES_NOT_ACCEPTED_MESSAGE,
} from './payments.constants';

/** A booking of either kind, with its kind. */
type OwnedBooking =
  | { type: BookingType.Flight; booking: FlightBookingSource }
  | { type: BookingType.Hotel; booking: HotelBookingSource };

/**
 * PAY-02: the provider's policies shown before payment and their acceptance.
 * The booking modules own the bookings; this service reaches them only
 * through `findOwnedEntityOrThrow` and `acceptPolicies`. It takes only a real
 * booking's type (`BookingKind`): a flight change (FLT-27) is paid through the
 * flight change port, never through these rules.
 */
@Injectable()
export class BookingPoliciesService {
  constructor(
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
  ) {}

  /** The policies of the user's own booking, in any status (404 otherwise). */
  async findPolicies(
    type: BookingKind,
    id: string,
    userId: string,
  ): Promise<BookingPoliciesResponseDto> {
    return toResponse(await this.findOwned(type, id, userId));
  }

  /**
   * Records the acceptance with one conditional update (the booking modules'
   * `acceptPolicies`): only the user's own booking, waiting for payment, with
   * a live hold, not accepted before. When nothing matched, one read tells
   * why: 404 for a missing booking or someone else's; 200 with the first
   * timestamp unchanged when it was already accepted (accepting twice is
   * harmless); 409 when it is not waiting for payment; 409 when the hold has
   * ended.
   */
  async acceptPolicies(
    type: BookingKind,
    id: string,
    userId: string,
  ): Promise<BookingPoliciesResponseDto> {
    const now = new Date();
    const accepted =
      type === BookingType.Flight
        ? await this.flightBookings.acceptPolicies(id, userId, now)
        : await this.hotelBookings.acceptPolicies(id, userId, now);
    if (accepted) {
      return type === BookingType.Flight
        ? toFlightBookingPolicies(accepted as FlightBookingSource)
        : toHotelBookingPolicies(accepted as HotelBookingSource);
    }

    const owned = await this.findOwned(type, id, userId);
    const { booking } = owned;
    if (booking.policyAcceptedAt) {
      return toResponse(owned);
    }
    assertPayable(booking, now);
    // Everything the update asked for holds now: it changed in between.
    throw new ConflictException(BOOKING_CHANGED_MESSAGE);
  }

  /**
   * PAY-02, the rule for PAY-01: what may be charged for the user's own
   * booking, only while it waits for payment, its hold is live at `now` and
   * its policies are accepted. 404 for a missing booking or someone else's,
   * 409 otherwise. Payment is blocked until the policies are accepted. No
   * route uses it: `PaymentsService` calls it before it creates a PaymentIntent (PAY-01).
   */
  async findPayableOrThrow(
    type: BookingKind,
    id: string,
    userId: string,
    now: Date,
  ): Promise<PayableBooking> {
    const { booking } = await this.findOwned(type, id, userId);
    const holdExpiresAt = assertPayable(booking, now);
    if (!booking.policyAcceptedAt) {
      throw new ConflictException(POLICIES_NOT_ACCEPTED_MESSAGE);
    }
    return {
      type,
      bookingId: booking._id.toString(),
      total: booking.total,
      currency: booking.currency,
      holdExpiresAt,
    };
  }

  private async findOwned(
    type: BookingKind,
    id: string,
    userId: string,
  ): Promise<OwnedBooking> {
    return type === BookingType.Flight
      ? {
          type,
          booking: await this.flightBookings.findOwnedEntityOrThrow(id, userId),
        }
      : {
          type,
          booking: await this.hotelBookings.findOwnedEntityOrThrow(id, userId),
        };
  }
}

function toResponse(owned: OwnedBooking): BookingPoliciesResponseDto {
  return owned.type === BookingType.Flight
    ? toFlightBookingPolicies(owned.booking)
    : toHotelBookingPolicies(owned.booking);
}

/**
 * 409 unless the booking waits for payment and its hold is live at `now`.
 * Returns the end of the hold.
 */
function assertPayable(
  booking: { status: string; holdExpiresAt?: Date },
  now: Date,
): Date {
  if (booking.status !== PENDING_PAYMENT) {
    throw new ConflictException(NOT_WAITING_FOR_PAYMENT_MESSAGE);
  }
  if (
    !booking.holdExpiresAt ||
    booking.holdExpiresAt.getTime() <= now.getTime()
  ) {
    throw new ConflictException(HOLD_EXPIRED_MESSAGE);
  }
  return booking.holdExpiresAt;
}
