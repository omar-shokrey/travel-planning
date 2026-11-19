import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { toLocalTime } from '../flights/flight-local-time';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { Flight } from '../flights/models/flight.schema';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import {
  bookingConfirmedMessage,
  type ConfirmedLeg,
} from './booking-confirmation-message';
import { newFlightReference } from './booking-reference';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { REFERENCE_ATTEMPTS } from './flight-bookings.constants';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import { FlightBooking } from './models/flight-booking.schema';

const MONGO_DUPLICATE_KEY = 11000;

/** The only unique index of a booking besides `_id` is `reference`. */
const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/**
 * FLT-23: what happens to a flight booking once its payment succeeded. The
 * payments webhook calls it through `FlightBookingsService.confirmPaid`, the
 * `BookingPaymentHandler` of PAY-01.
 *
 * 1. **Confirm** with one conditional update that matches only a booking
 *    still `pending_payment` whose hold is live at `now`, and gives it its
 *    reference. The hold-expiry job (FLT-22) matches the opposite condition
 *    (`holdExpiresAt <= now`), so the two can never both win.
 * 2. **Book the seats**: each segment's held seats become booked seats
 *    (`FlightSeatHoldsService.confirm`).
 * 3. **Notify** the owner (GEN-01).
 *
 * The booking is confirmed first because it is the user's proof of payment.
 * Steps 2 and 3 never undo it: a failure there is logged. Seats that could not
 * be moved stay counted as held, which never oversells a flight, until the
 * counters are recomputed from the bookings.
 */
@Injectable()
export class FlightBookingConfirmationService {
  private readonly logger = new Logger(FlightBookingConfirmationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly flightResponses: FlightResponsesService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Returns `true` when the booking is confirmed, now or before (the same
   * event can arrive twice: the second call changes nothing and sends no
   * second notification). Returns `false`, without throwing, for an unknown
   * booking and for one whose hold had ended or that is no longer waiting for
   * payment: that payment is late (refund, PAY-03). A database error throws,
   * so the webhook answers 500 and Stripe sends the event again.
   */
  async confirmPaid(bookingId: string, now: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(bookingId)) {
      this.logger.warn(`A payment names an invalid booking id ${bookingId}`);
      return false;
    }
    const confirmed = await this.confirmWithReference(bookingId, now);
    if (!confirmed) {
      return this.wasConfirmedBefore(bookingId);
    }
    await this.bookSeats(confirmed);
    await this.notifyOwner(confirmed);
    return true;
  }

  /**
   * The confirming update. A new reference that another booking already has
   * fails on the unique index; the update is then tried again with a new one,
   * at most REFERENCE_ATTEMPTS times.
   */
  private async confirmWithReference(
    bookingId: string,
    now: Date,
  ): Promise<FlightBookingSource | null> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.bookings
          .findOneAndUpdate(
            {
              _id: bookingId,
              status: FlightBookingStatus.PendingPayment,
              holdExpiresAt: { $gt: now },
            },
            {
              $set: {
                status: FlightBookingStatus.Confirmed,
                reference: newFlightReference(),
              },
            },
            { returnDocument: 'after' },
          )
          .lean()
          .exec();
      } catch (error) {
        if (!isDuplicateKey(error) || attempt >= REFERENCE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * Nothing matched: the booking does not exist, was confirmed before (a
   * repeated event), or is not payable any more. Only a confirmed booking has
   * a reference, and it keeps it when it is completed or cancelled later.
   */
  private async wasConfirmedBefore(bookingId: string): Promise<boolean> {
    const booking = await this.bookings
      .findById(bookingId)
      .select('reference status')
      .lean()
      .exec();
    if (!booking) {
      this.logger.warn(
        `A payment names an unknown flight booking ${bookingId}`,
      );
      return false;
    }
    return Boolean(booking.reference);
  }

  private async bookSeats(booking: FlightBookingSource): Promise<void> {
    const id = booking._id.toString();
    for (const segment of booking.segments) {
      let booked = false;
      try {
        booked = await this.seatHolds.confirm(
          segment.flightId,
          segment.cabin,
          segment.seatsReserved,
        );
      } catch (error) {
        this.logger.error(
          `Flight booking ${id}: moving the seats failed`,
          error instanceof Error ? error.stack : error,
        );
      }
      if (!booked) {
        this.logger.error(
          `Flight booking ${id} is confirmed but its ${segment.seatsReserved} ${segment.cabin} seat(s) of flight ${segment.flightId.toString()} are still counted as held. Recompute the seat counters from the bookings.`,
        );
      }
    }
  }

  /**
   * The in-app notification, after the confirmation is saved. Reading the
   * flights or sending can fail; that is logged with the booking id only (no
   * passenger data) and never turns the confirmation into an error.
   */
  private async notifyOwner(booking: FlightBookingSource): Promise<void> {
    try {
      const message = bookingConfirmedMessage(
        booking.reference ?? '',
        await this.legsOf(booking),
        booking.passengerCounts.infants,
      );
      await this.notifications.notify(
        booking.userId,
        NotificationType.BookingConfirmed,
        message,
        { type: NotificationLinkType.FlightBooking, id: booking._id },
      );
    } catch (error) {
      this.logger.error(
        `Flight booking ${booking._id.toString()} is confirmed, but its notification was not sent`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /** Each segment's flight with its local departure time (GEN-06), in booking order. */
  private async legsOf(booking: FlightBookingSource): Promise<ConfirmedLeg[]> {
    const flights = await this.flights
      .find({ _id: { $in: booking.segments.map((s) => s.flightId) } })
      .select('flightNumber departureAirport arrivalAirport departureAt')
      .lean()
      .exec();
    const zones = await this.flightResponses.timeZonesOf(
      flights.map((flight) => flight.departureAirport),
    );
    return booking.segments.map((segment) => {
      const flight = flights.find((f) => f._id.equals(segment.flightId));
      const zone = flight && zones.get(flight.departureAirport);
      if (!flight || !zone) {
        throw new Error(
          `Flight ${segment.flightId.toString()} or its airport zone is missing`,
        );
      }
      return {
        flightNumber: flight.flightNumber,
        departureAirport: flight.departureAirport,
        arrivalAirport: flight.arrivalAirport,
        departureLocal: toLocalTime(flight.departureAt, zone).local,
        cabin: segment.cabin,
        seats: segment.seatsReserved,
      };
    });
  }
}
