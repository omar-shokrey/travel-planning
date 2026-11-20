import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Types, type Model } from 'mongoose';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import {
  type CancelledFlight,
  FlightsService,
} from '../flights/flights.service';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import { RefundsService } from '../payments/refunds/refunds.service';
import type { FlightCancellationResponseDto } from './dto/flight-cancellation-response.dto';
import { CancelledBy } from './enums/cancelled-by.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { flightCancelledMessage } from './flight-cancelled-message';
import { FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE } from './flight-bookings.constants';
import { FlightChangeService } from './flight-change.service';
import { FlightSeatsService } from './flight-seats.service';
import { FlightBooking } from './models/flight-booking.schema';

/** What the cascade reads of a booking. */
type AffectedBooking = Pick<
  FlightBooking,
  'userId' | 'reference' | 'status' | 'segments' | 'total' | 'currency'
> & { _id: Types.ObjectId };

/** How many bookings one cascade changed. */
export interface CascadeResult {
  cancelledBookings: number;
  expiredHolds: number;
}

/**
 * FLT-06: the airline cancels a scheduled flight. The flight becomes
 * cancelled (FlightsService, the flights module); then every confirmed
 * booking with a segment on it becomes cancelled with a 100% refund (PAY-03),
 * its passengers' seats go back and its owner gets an in-app notification
 * (GEN-01); every hold waiting for payment on it expires and its seats are
 * released. A round trip is cancelled as a whole. An hourly sweep finishes
 * any cascade a crash or an error interrupted.
 */
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // Read only: the cancelled flights the sweep finds.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly flightsService: FlightsService,
    private readonly flightResponses: FlightResponsesService,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationsService,
    private readonly seatAssignments: FlightSeatsService,
    // FLT-27: the open changes of a cancelled booking or to a cancelled
    // flight, and the paid changes refunded in full with the booking.
    private readonly changes: FlightChangeService,
  ) {}

  /**
   * POST /api/flights/:id/cancel. The flight is cancelled first (its 403,
   * 404 and 409 answers come from there and change nothing); the cascade
   * then never undoes it: a booking it cannot finish is left to the sweep.
   */
  async cancelFlight(
    flightId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<FlightCancellationResponseDto> {
    const flight = await this.flightsService.cancel(flightId, userId, now);
    const result = await this.cascade(flight, now);
    return {
      flight: await this.flightResponses.toResponse(flight, now),
      ...result,
    };
  }

  /**
   * The bookings of one cancelled flight: confirmed ones are cancelled and
   * refunded in full, holds expire. Each booking is one conditional update
   * that matches the status it leaves (GEN-11), so a booking is cancelled
   * once even if the sweep or a user's cancellation (FLT-26) runs at the same
   * moment. A failure on one booking is logged and the others go on.
   */
  async cascade(flight: CancelledFlight, now: Date): Promise<CascadeResult> {
    // FLT-27: a change waiting for payment to this flight can never fly it.
    await this.changes
      .closePendingChangesTo(flight._id, now)
      .catch((error: unknown) =>
        this.logger.error(
          `Flight ${flight._id.toString()} is cancelled, but the flight changes waiting for payment to it were not closed; the sweep tries again`,
          error instanceof Error ? error.stack : error,
        ),
      );
    const affected = await this.bookings
      .find({
        'segments.flightId': flight._id,
        status: {
          $in: [
            FlightBookingStatus.Confirmed,
            FlightBookingStatus.PendingPayment,
          ],
        },
      })
      .select('userId reference status segments total currency')
      .lean<AffectedBooking[]>()
      .exec();

    const result: CascadeResult = { cancelledBookings: 0, expiredHolds: 0 };
    for (const booking of affected) {
      try {
        if (booking.status === FlightBookingStatus.Confirmed) {
          result.cancelledBookings += await this.cancelBooking(
            booking,
            flight,
            now,
          );
        } else {
          result.expiredHolds += await this.expireHold(booking);
        }
      } catch (error) {
        this.logger.error(
          `Flight ${flight._id.toString()} is cancelled, but booking ${booking._id.toString()} was not updated; the sweep tries again`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return result;
  }

  /**
   * The hourly sweep: the bookings still confirmed or held on a cancelled
   * flight (a cascade stopped by a crash or an error), at most
   * FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE per run, are cancelled or expired
   * the same way. Every error is logged so the app never crashes.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'flight-cancellation-sweep' })
  async sweepJob(): Promise<void> {
    try {
      const { cancelledBookings, expiredHolds } = await this.sweep(new Date());
      if (cancelledBookings + expiredHolds > 0) {
        this.logger.log(
          `Finished the cancellation of ${cancelledBookings} booking(s) and ${expiredHolds} hold(s) on cancelled flights`,
        );
      }
    } catch (error) {
      this.logger.error(
        'The flight cancellation sweep failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /** One run of the sweep; returns what it changed. */
  async sweep(now: Date): Promise<CascadeResult> {
    const left = await this.bookings
      .aggregate<{ _id: Types.ObjectId }>([
        {
          $match: {
            status: {
              $in: [
                FlightBookingStatus.Confirmed,
                FlightBookingStatus.PendingPayment,
              ],
            },
          },
        },
        {
          $lookup: {
            from: this.flights.collection.collectionName,
            localField: 'segments.flightId',
            foreignField: '_id',
            pipeline: [
              { $match: { status: FlightStatus.Cancelled } },
              { $project: { _id: 1 } },
            ],
            as: 'cancelledFlights',
          },
        },
        { $match: { 'cancelledFlights.0': { $exists: true } } },
        { $limit: FLIGHT_CANCELLATION_SWEEP_BATCH_SIZE },
        { $unwind: '$cancelledFlights' },
        { $group: { _id: '$cancelledFlights._id' } },
      ])
      .exec();

    const total: CascadeResult = { cancelledBookings: 0, expiredHolds: 0 };
    for (const { _id } of left) {
      const flight = await this.flights
        .findById(_id)
        .lean<CancelledFlight>()
        .exec();
      if (!flight) continue;
      const result = await this.cascade(flight, now);
      total.cancelledBookings += result.cancelledBookings;
      total.expiredHolds += result.expiredHolds;
    }
    return total;
  }

  /**
   * Confirmed -> Cancelled by the provider with a 100% refund. Returns 1 if
   * this call cancelled it, 0 if it was no longer confirmed. After the
   * update, the seats, the refund and the notification never undo it: each
   * failure is logged (a refund Stripe did not accept stays pending and is
   * retried by PAY-03).
   */
  private async cancelBooking(
    booking: AffectedBooking,
    flight: CancelledFlight,
    now: Date,
  ): Promise<number> {
    const { matchedCount } = await this.bookings
      .updateOne(
        { _id: booking._id, status: FlightBookingStatus.Confirmed },
        {
          $set: {
            status: FlightBookingStatus.Cancelled,
            cancelledAt: now,
            cancelledBy: CancelledBy.Provider,
            refundPercent: 100,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      return 0;
    }
    const id = booking._id.toString();
    for (const segment of booking.segments) {
      await this.seatHolds
        .unbook(segment.flightId, segment.cabin, segment.seatsReserved)
        .catch((error: unknown) => this.logFailure(id, 'seats', error));
    }
    await this.seatAssignments
      .releaseBooking(booking._id)
      .catch((error: unknown) =>
        this.logFailure(id, 'chosen seats (FLT-28)', error),
      );
    await this.changes
      .closeOpenChangeOf(booking._id, now)
      .catch((error: unknown) =>
        this.logFailure(id, 'open flight change (FLT-27)', error),
      );
    await this.refunds
      .refund({
        bookingType: BookingType.Flight,
        bookingId: id,
        refundPercent: 100,
        reason: RefundReason.FlightCancelled,
      })
      .catch((error: unknown) => this.logFailure(id, 'refund', error));
    // FLT-27: each dearer flight change was paid by its own payment.
    const paidChanges = await this.changes
      .paidDifferencesOf(booking._id)
      .catch((error: unknown) => {
        this.logFailure(id, 'reading its paid flight changes', error);
        return [];
      });
    for (const paid of paidChanges) {
      await this.refunds
        .refund({
          bookingType: BookingType.FlightChange,
          bookingId: paid.id,
          refundPercent: 100,
          reason: RefundReason.FlightCancelled,
        })
        .catch((error: unknown) =>
          this.logFailure(id, `refund of flight change ${paid.id}`, error),
        );
    }
    await this.notifications
      .notify(
        booking.userId,
        NotificationType.BookingCancelled,
        flightCancelledMessage(
          flight,
          booking.reference,
          booking.total,
          booking.currency,
        ),
        { type: NotificationLinkType.FlightBooking, id },
      )
      .catch((error: unknown) => this.logFailure(id, 'notification', error));
    return 1;
  }

  /** Pending Payment -> Expired, then its held seats are released. Returns 1 if this call expired it. */
  private async expireHold(booking: AffectedBooking): Promise<number> {
    const { matchedCount } = await this.bookings
      .updateOne(
        { _id: booking._id, status: FlightBookingStatus.PendingPayment },
        { $set: { status: FlightBookingStatus.Expired } },
      )
      .exec();
    if (matchedCount === 0) {
      return 0;
    }
    const id = booking._id.toString();
    for (const segment of booking.segments) {
      await this.seatHolds
        .release(segment.flightId, segment.cabin, segment.seatsReserved)
        .catch((error: unknown) => this.logFailure(id, 'seats', error));
    }
    await this.seatAssignments
      .releaseBooking(booking._id)
      .catch((error: unknown) =>
        this.logFailure(id, 'chosen seats (FLT-28)', error),
      );
    return 1;
  }

  private logFailure(bookingId: string, what: string, error: unknown): void {
    this.logger.error(
      `Booking ${bookingId} is cancelled by its airline, but its ${what} failed`,
      error instanceof Error ? error.stack : error,
    );
  }
}
